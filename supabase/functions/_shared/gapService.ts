// Request handling for the gap-assessment Edge Function, written against a small Store interface so the
// same code runs on Supabase (index.ts) and in Node tests with an in-memory store, a fake model and a fake
// network. No Deno APIs here.
//
// Actions (POST JSON { action, ... }):
//   start   business name, website (optional), currency -> read the website, open the conversation.
//           Nothing personal is asked up front.
//   chat    one visitor message -> the interviewer's next message and progress
//   report  build the gap report and ROI (once; later calls return the stored report)
//   resume  rebuild the page after a refresh
//   contact after the report: name, email, phone -> an active lead in the sales pipeline + team email
//   event   pdf_downloaded / cta_clicked, for the CRM
//
// The browser only ever holds a random token; the database stores its hash.

import {
  buildConfig, buildContents, buildInterviewerSystem, buildReportContents, buildReportSystem, clean, CONFIG_KEYS,
  computeProgress, heardFromLabel, inquiryMessage, isToken, newToken, parseCurrency, parseJsonLoose, parseTurn, plain, sanitiseReport, sha256Hex,
  staffBand, teamEmail, validateContact, validateStart,
} from './gapAssessment.ts'
import { classifySource, SOURCE_LABELS } from './pipelineSource.ts'
import type { GapConfig, Message, Report, Turn } from './gapAssessment.ts'
import { callJson, LlmError } from './llm.ts'
import type { CallOptions } from './llm.ts'
import { domainReceivesMail, fetchSiteSummary } from './netChecks.ts'
import type { Resolver } from './netChecks.ts'

export interface SessionRow {
  id: string
  token_hash: string
  status: 'in_progress' | 'report_ready'
  full_name: string | null
  email: string | null
  phone?: string | null
  company_name: string
  website_url: string | null
  website_summary: string | null
  areas_covered: string[]
  user_turns: number
  report: Report | null
  inquiry_id: string | null
  pipeline_lead_id?: string | null
  contact_requested_at?: string | null
  source_channel?: string | null
  page_url?: string | null
  referrer?: string | null
  utm_source?: string | null
  utm_medium?: string | null
  utm_campaign?: string | null
  utm_term?: string | null
  llm_calls: number
  input_tokens: number
  output_tokens: number
  pdf_downloaded_at: string | null
  cta_clicked_at: string | null
  heard_from?: string | null
  heard_from_other?: string | null
  // Working behind the report. Before the report exists it only holds the visitor's chosen currency.
  report_internal?: { currency?: string } | null
}

export interface Store {
  config(): Promise<{ key: string; value: string | null }[]>
  rateLimit(action: string, max: number, windowMinutes: number): Promise<boolean>
  createSession(row: Record<string, unknown>): Promise<SessionRow>
  findByTokenHash(hash: string): Promise<SessionRow | null>
  lock(id: string, staleBeforeIso: string, nowIso: string): Promise<boolean>
  unlock(id: string): Promise<void>
  updateSession(id: string, patch: Record<string, unknown>): Promise<void>
  messages(id: string): Promise<Message[]>
  addMessages(id: string, startSeq: number, msgs: Message[]): Promise<void>
  // Stage 2 of the Custom builds pipeline. Returns the new lead's id.
  createPipelineLead(row: Record<string, unknown>): Promise<string>
  // Only used if the pipeline table is missing (migration-sales-pipeline.sql not run yet).
  createInquiry(row: Record<string, unknown>): Promise<string | null>
  staffEmails(): Promise<string[]>
}

export interface Deps {
  store: Store
  resolver: Resolver
  fetchImpl: typeof fetch
  geminiKey: string | undefined
  sendEmail: (to: string[], subject: string, html: string) => Promise<void>
  call?: typeof callJson
  now?: () => Date
  ipHash?: string
}

export interface Reply { status: number; body: Record<string, unknown> }
const ok = (body: Record<string, unknown> = {}): Reply => ({ status: 200, body: { ok: true, ...body } })
const fail = (status: number, error: string, extra: Record<string, unknown> = {}): Reply => ({ status, body: { error, ...extra } })

const MIN_FILL_MS = 2000
const LOCK_STALE_MS = 90_000
const DEFAULT_APP_URL = 'https://spm.sdfmgroup.com'

async function loadConfig(store: Store): Promise<{ cfg: GapConfig; appUrl: string }> {
  const rows = await store.config()
  const appUrl = (rows.find(r => r.key === 'app_base_url')?.value || DEFAULT_APP_URL).replace(/\/+$/, '')
  return { cfg: buildConfig(rows.filter(r => CONFIG_KEYS.includes(r.key))), appUrl }
}

const firstName = (full: string | null) => (full || '').trim().split(/\s+/)[0] || 'there'

function openingFallback(name: string | null, company: string): Turn {
  return {
    reply: `Hi ${firstName(name)}, thanks for starting the Automation scoper for ${company}. I'll ask about how the business runs, one question at a time, and you'll get a written report at the end. To begin: what does ${company} do, and roughly how many people work there?`,
    areas_covered: [], suggested_replies: ['1 to 5', '6 to 15', '16 to 50', 'More than 50'], ready_for_report: false,
  }
}

// A model that answers in plain text instead of JSON is still a usable interviewer.
function lenientTurn(text: string, cfg: GapConfig, covered: string[]): Turn | null {
  const strict = parseTurn(text, cfg, covered)
  if (strict) return strict
  const t = plain(text, 1200)
  if (t.length < 12 || t.startsWith('{') || t.startsWith('[')) return null
  return { reply: t, areas_covered: covered, suggested_replies: [], ready_for_report: false }
}

function llmFailure(err: unknown): Reply {
  if (err instanceof LlmError) {
    console.error('[gap-assessment] model call failed:', err.code, err.message)
    if (err.code === 'busy') return fail(503, 'ai_busy')
    return fail(503, 'ai_unavailable')
  }
  throw err
}

function sessionCurrency(session: SessionRow, cfg: GapConfig): string {
  return parseCurrency(session.report_internal?.currency, cfg) || 'KES'
}

function progressOf(cfg: GapConfig, covered: string[], turns: number) {
  return computeProgress(cfg, covered, turns)
}

// ── start ────────────────────────────────────────────────────────────────

async function start(body: Record<string, unknown>, deps: Deps): Promise<Reply> {
  const { store } = deps
  const { cfg } = await loadConfig(store)
  if (!cfg.settings.enabled) return fail(503, 'disabled')

  // Honeypot filled, or sent faster than a person can fill the form: pretend it worked, save nothing.
  const tooFast = typeof body.elapsed_ms === 'number' && body.elapsed_ms < MIN_FILL_MS
  if ((typeof body.hp === 'string' && body.hp.trim() !== '') || tooFast) {
    return ok({ token: newToken(), messages: [{ role: 'assistant', content: openingFallback(null, String(body.company_name || 'your business')).reply }], suggested_replies: [], progress: progressOf(cfg, [], 0) })
  }

  const { errors, value } = validateStart(body, cfg)
  if (!value) return fail(400, 'validation', { fields: errors })

  if (!(await store.rateLimit('ga_start', 5, 60))) return fail(429, 'rate_limited')

  const siteSummary = value.website_url ? await fetchSiteSummary(value.website_url, deps.resolver, deps.fetchImpl) : ''

  // Opening message. If every model is down, start anyway with a fixed opening: the visitor is already here.
  let turn: Turn = openingFallback(null, value.company_name)
  let usage = { model: null as string | null, calls: 0, input: 0, output: 0 }
  try {
    const system = buildInterviewerSystem(cfg, { name: '', company: value.company_name, website: value.website_url || '', siteSummary, covered: [], userTurns: 0, currency: value.currency })
    const res = await (deps.call || callJson)(modelOptions(cfg, deps, system, buildContents([]), 2048, 0.7, 25000), t => lenientTurn(t, cfg, []))
    turn = { ...res.value, areas_covered: [], ready_for_report: false }
    usage = { model: res.model, calls: 1, input: res.inputTokens, output: res.outputTokens }
  } catch (err) {
    if (!(err instanceof LlmError)) throw err
    console.error('[gap-assessment] opening used the fixed message:', err.code, err.message)
  }

  const token = newToken()
  const attribution = {
    page_url: clean(body.page_url, 300) || null, referrer: clean(body.referrer, 300) || null,
    utm_source: clean(body.utm_source, 100) || null, utm_medium: clean(body.utm_medium, 100) || null,
    utm_campaign: clean(body.utm_campaign, 150) || null, utm_term: clean(body.utm_term, 150) || null,
  }
  const session = await store.createSession({
    token_hash: await sha256Hex(token),
    company_name: value.company_name, website_url: value.website_url, website_summary: siteSummary || null,
    source_channel: classifySource({ ...attribution, heard_from: value.heard_from }),
    report_internal: { currency: value.currency },
    heard_from: value.heard_from, heard_from_other: value.heard_from_other,
    model: usage.model, llm_calls: usage.calls, input_tokens: usage.input, output_tokens: usage.output,
    ...attribution,
    ip_hash: deps.ipHash || null,
  })
  await store.addMessages(session.id, 1, [{ role: 'assistant', content: turn.reply }])

  return ok({
    token,
    messages: [{ role: 'assistant', content: turn.reply }],
    suggested_replies: turn.suggested_replies,
    progress: progressOf(cfg, [], 0),
  })
}

function modelOptions(cfg: GapConfig, deps: Deps, system: string, contents: CallOptions['contents'], maxOutputTokens: number, temperature: number, timeoutMs: number): CallOptions {
  return {
    apiKey: deps.geminiKey, models: [cfg.settings.model, cfg.settings.fallback_model],
    system, contents, maxOutputTokens, temperature, timeoutMs, fetchImpl: deps.fetchImpl,
  }
}

async function sessionFor(body: Record<string, unknown>, store: Store): Promise<SessionRow | null> {
  if (!isToken(body.token)) return null
  return store.findByTokenHash(await sha256Hex(body.token))
}

// ── chat ─────────────────────────────────────────────────────────────────

async function chat(body: Record<string, unknown>, deps: Deps): Promise<Reply> {
  const { store } = deps
  const now = (deps.now || (() => new Date()))()
  const session = await sessionFor(body, store)
  if (!session) return fail(404, 'not_found')
  if (session.status === 'report_ready') return fail(409, 'finished')

  const text = clean(body.message, 1500)
  if (!text) return fail(400, 'invalid_request')

  const { cfg } = await loadConfig(store)
  if (!(await store.rateLimit('ga_chat', 80, 60))) return fail(429, 'rate_limited')
  if (session.user_turns >= cfg.settings.max_user_turns) return fail(409, 'turn_limit', { progress: progressOf(cfg, session.areas_covered, session.user_turns) })

  if (!(await store.lock(session.id, new Date(now.getTime() - LOCK_STALE_MS).toISOString(), now.toISOString()))) return fail(409, 'busy')
  try {
    const history = await store.messages(session.id)
    const turns = session.user_turns + 1
    const system = buildInterviewerSystem(cfg, {
      name: session.full_name || '', company: session.company_name, website: session.website_url || '',
      siteSummary: session.website_summary || '', covered: session.areas_covered, userTurns: turns,
      currency: sessionCurrency(session, cfg),
    })
    const contents = buildContents([...history, { role: 'user', content: text }])
    let res
    try {
      res = await (deps.call || callJson)(modelOptions(cfg, deps, system, contents, 2048, 0.7, 25000), t => lenientTurn(t, cfg, session.areas_covered))
    } catch (err) {
      return llmFailure(err) // the visitor's message was not stored, so they can send it again
    }

    const turn = res.value
    const progress = progressOf(cfg, turn.areas_covered, turns)
    const ready = progress.at_limit || (turn.ready_for_report && progress.can_finish)

    await store.addMessages(session.id, history.length + 1, [{ role: 'user', content: text }, { role: 'assistant', content: turn.reply }])
    await store.updateSession(session.id, {
      areas_covered: turn.areas_covered, user_turns: turns, last_activity_at: now.toISOString(), model: res.model,
      llm_calls: session.llm_calls + 1, input_tokens: session.input_tokens + res.inputTokens, output_tokens: session.output_tokens + res.outputTokens,
    })
    return ok({ reply: turn.reply, suggested_replies: ready ? [] : turn.suggested_replies, progress, ready })
  } finally {
    await store.unlock(session.id)
  }
}

// ── report ───────────────────────────────────────────────────────────────

async function report(body: Record<string, unknown>, deps: Deps): Promise<Reply> {
  const { store } = deps
  const now = (deps.now || (() => new Date()))()
  const session = await sessionFor(body, store)
  if (!session) return fail(404, 'not_found')
  if (session.status === 'report_ready' && session.report) return ok({ report: session.report })

  const { cfg } = await loadConfig(store)
  const progress = progressOf(cfg, session.areas_covered, session.user_turns)
  if (!progress.can_finish && !progress.at_limit) return fail(409, 'not_ready', { progress })
  if (!(await store.rateLimit('ga_report', 6, 60))) return fail(429, 'rate_limited')

  if (!(await store.lock(session.id, new Date(now.getTime() - LOCK_STALE_MS * 2).toISOString(), now.toISOString()))) return fail(409, 'busy')
  try {
    // Another tab may have finished it while this request waited.
    const fresh = await store.findByTokenHash(session.token_hash)
    if (fresh?.status === 'report_ready' && fresh.report) return ok({ report: fresh.report })

    const messages = await store.messages(session.id)
    const currency = sessionCurrency(session, cfg)
    const ctx = { name: session.full_name || '', company: session.company_name, website: session.website_url || '', siteSummary: session.website_summary || '', currency }
    let res
    try {
      res = await (deps.call || callJson)(
        modelOptions(cfg, deps, buildReportSystem(cfg), buildReportContents(cfg, ctx, messages), 8192, 0.3, 55000),
        t => {
          const j = parseJsonLoose(t) as { gaps?: unknown } | null
          return j && Array.isArray(j.gaps) ? sanitiseReport(j, cfg, { company: session.company_name, website: session.website_url || '', now, currency }) : null
        },
      )
    } catch (err) {
      return llmFailure(err)
    }
    const { report: rep, internal } = res.value

    await store.updateSession(session.id, {
      status: 'report_ready', report: rep, report_internal: internal, report_generated_at: now.toISOString(),
      model: res.model, last_activity_at: now.toISOString(),
      llm_calls: session.llm_calls + 1, input_tokens: session.input_tokens + res.inputTokens, output_tokens: session.output_tokens + res.outputTokens,
    })

    // No hand-off yet: the visitor is anonymous. They become a lead only if they ask to be contacted.
    return ok({ report: rep })
  } finally {
    await store.unlock(session.id)
  }
}

// ── contact: the ask at the end of the report ───────────────────────────────
// "Want to explore closing these gaps? Leave your details and we'll be in touch." The visitor becomes an
// active lead (stage 2) in the Custom builds pipeline and the team is emailed. Safe to call twice.

async function contact(body: Record<string, unknown>, deps: Deps): Promise<Reply> {
  const { store } = deps
  const now = (deps.now || (() => new Date()))()
  const session = await sessionFor(body, store)
  if (!session) return fail(404, 'not_found')
  if (session.status !== 'report_ready' || !session.report) return fail(409, 'not_ready')
  if (session.pipeline_lead_id || session.contact_requested_at) return ok({ already: true })

  const { cfg, appUrl } = await loadConfig(store)
  const { errors, value } = validateContact(body, cfg)
  if (!value) return fail(400, 'validation', { fields: errors })
  if (!(await store.rateLimit('ga_contact', 5, 60))) return fail(429, 'rate_limited')
  if ((await domainReceivesMail(value.email_domain, deps.resolver)) === false) {
    return fail(400, 'validation', { fields: { email: `${value.email_domain} does not look like an email domain that receives mail. Check for typos.` } })
  }

  const rep = session.report
  const heard = heardFromLabel(session.heard_from, session.heard_from_other)
  const channel = session.source_channel || classifySource({ ...session })
  const summary = inquiryMessage(rep, appUrl, session.id, heard)
  const fullSummary = value.note ? `They said: ${value.note}\n\n${summary}` : summary
  const r = rep.roi

  // Mark the session first so a double tap cannot create two leads.
  await store.updateSession(session.id, {
    full_name: value.full_name, email: value.email, email_domain: value.email_domain, phone: value.phone,
    contact_requested_at: now.toISOString(),
  })

  let leadId: string | null = null
  try {
    leadId = await store.createPipelineLead({
      service_line: 'custom_build', stage: 'active', entry_point: 'scoper',
      full_name: value.full_name, email: value.email, phone: value.phone, role_title: value.role_title,
      company_name: session.company_name, website_url: session.website_url,
      source_channel: channel, source_detail: heard ? `Automation scoper · heard via ${heard}` : 'Automation scoper',
      assessment_id: session.id, summary: fullSummary.slice(0, 4000),
      staff_band: staffBand(rep.company.staff_estimate), sector: rep.company.sector || null,
      estimated_value: r.quantified_gaps ? Math.round(r.annual_expected) : null, currency: r.currency || 'KES',
      page_url: session.page_url ?? null, referrer: session.referrer ?? null,
      utm_source: session.utm_source ?? null, utm_medium: session.utm_medium ?? null,
      utm_campaign: session.utm_campaign ?? null, utm_term: session.utm_term ?? null,
    })
    await store.updateSession(session.id, { pipeline_lead_id: leadId })
  } catch (err) {
    // Pipeline not set up yet: keep the old behaviour so the lead is never lost.
    console.error('[gap-assessment] pipeline lead failed, saving an inquiry instead', (err as Error).message)
    try {
      const inquiryId = await store.createInquiry({
        full_name: value.full_name, company_name: session.company_name, email: value.email, phone: value.phone,
        has_whatsapp: false, channel: 'website', source_detail: 'Automation scoper (free tool)',
        message: fullSummary.slice(0, 1900), status: 'new', next_follow_up: new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10),
        offer: 'gap_check', staff_band: staffBand(rep.company.staff_estimate),
      })
      if (inquiryId) await store.updateSession(session.id, { inquiry_id: inquiryId })
    } catch (err2) {
      console.error('[gap-assessment] inquiry failed too', (err2 as Error).message)
      await store.updateSession(session.id, { contact_requested_at: null })
      return fail(500, 'server_error')
    }
  }

  // Team alert. Best effort: the lead is saved, so this may not fail the request.
  try {
    const to = await store.staffEmails()
    if (to.length) {
      const mail = teamEmail({
        id: session.id, full_name: value.full_name, company_name: session.company_name, email: value.email, phone: value.phone,
        website_url: session.website_url, heard, note: value.note, source: SOURCE_LABELS[channel as keyof typeof SOURCE_LABELS] || '', leadId,
      }, rep, appUrl)
      await Promise.race([deps.sendEmail(to, mail.subject, mail.html), new Promise(resolve => setTimeout(resolve, 8000))])
    }
  } catch (err) {
    console.error('[gap-assessment] team email failed', (err as Error).message)
  }
  return ok()
}

// ── resume / event ───────────────────────────────────────────────────────

async function resume(body: Record<string, unknown>, deps: Deps): Promise<Reply> {
  const session = await sessionFor(body, deps.store)
  if (!session) return fail(404, 'not_found')
  const { cfg } = await loadConfig(deps.store)
  const messages = await deps.store.messages(session.id)
  const progress = progressOf(cfg, session.areas_covered, session.user_turns)
  return ok({
    status: session.status,
    company: { name: session.company_name, full_name: session.full_name },
    messages,
    progress,
    ready: progress.at_limit,
    report: session.status === 'report_ready' ? session.report : null,
    contacted: !!(session.pipeline_lead_id || session.contact_requested_at),
  })
}

async function event(body: Record<string, unknown>, deps: Deps): Promise<Reply> {
  const session = await sessionFor(body, deps.store)
  if (!session) return fail(404, 'not_found')
  const now = (deps.now || (() => new Date()))().toISOString()
  if (body.event === 'pdf_downloaded' && !session.pdf_downloaded_at) {
    await deps.store.updateSession(session.id, { pdf_downloaded_at: now })
  } else if (body.event === 'cta_clicked' && !session.cta_clicked_at) {
    const kind = ['assessment', 'contact', 'whatsapp'].includes(String(body.kind)) ? String(body.kind) : 'other'
    await deps.store.updateSession(session.id, { cta_clicked_at: now, cta_kind: kind })
  } else if (body.event !== 'pdf_downloaded' && body.event !== 'cta_clicked') {
    return fail(400, 'invalid_request')
  }
  return ok()
}

// ── entry ────────────────────────────────────────────────────────────────

export async function handleGapRequest(body: unknown, deps: Deps): Promise<Reply> {
  if (!body || typeof body !== 'object') return fail(400, 'invalid_request')
  const b = body as Record<string, unknown>
  try {
    switch (b.action) {
      case 'start': return await start(b, deps)
      case 'chat': return await chat(b, deps)
      case 'report': return await report(b, deps)
      case 'resume': return await resume(b, deps)
      case 'contact': return await contact(b, deps)
      case 'event': return await event(b, deps)
      default: return fail(400, 'invalid_request')
    }
  } catch (err) {
    console.error('[gap-assessment]', err)
    return fail(500, 'server_error')
  }
}

