// Supabase Edge Function: gap-assessment
// Public. Runs the free Automation scoper on sdfmgroup.com/ai-gap-check: validates the visitor, interviews them
// with Gemini, builds the gap report and ROI, and hands the finished assessment to the team (an inquiry in
// the CRM plus an email). The browser never sees the API key, the prompts or the working behind the ROI.
//
// All behaviour is in _shared/gapService.ts (tested under Node). This file only connects it to Supabase,
// Resend and the network.
//
// Deploy:  supabase functions deploy gap-assessment --no-verify-jwt
// Secrets: supabase secrets set GEMINI_API_KEY=...   (Google AI Studio; RESEND_API_KEY and SENDER_EMAIL as for the other functions)
// Needs:   migration-gap-assessments.sql, migration-booking-flow.sql (booking_attempts rate limit table)

import { adminClient, allowRequest, ipHash, json, preflight } from '../_shared/booking.ts'
import { requireResendKey, sendViaResend } from '../_shared/resend.ts'
import { staffWithModule } from '../_shared/access.ts'
import { CONFIG_KEYS } from '../_shared/gapAssessment.ts'
import { handleGapRequest } from '../_shared/gapService.ts'
import type { SessionRow, Store } from '../_shared/gapService.ts'
import { makeResolver } from '../_shared/netChecks.ts'

function supabaseStore(admin: any, ip: string): Store {
  const fail = (what: string, error: any) => { throw new Error(`${what}: ${error?.message || error}`) }
  return {
    async config() {
      const { data } = await admin.from('system_settings').select('key, value').in('key', [...CONFIG_KEYS, 'app_base_url'])
      return data || []
    },
    rateLimit: (action, max, windowMinutes) => allowRequest(admin, ip, action, max, windowMinutes),
    async countSessionsSince(iso) {
      const { count } = await admin.from('gap_assessments').select('id', { count: 'exact', head: true }).gte('created_at', iso)
      return count ?? 0
    },
    async countSessionsForEmailSince(email, iso) {
      const { count } = await admin.from('gap_assessments').select('id', { count: 'exact', head: true }).eq('email', email).gte('created_at', iso)
      return count ?? 0
    },
    async createSession(row) {
      const { data, error } = await admin.from('gap_assessments').insert(row).select('*').single()
      if (error) fail('create session', error)
      return data as SessionRow
    },
    async findByTokenHash(hash) {
      const { data } = await admin.from('gap_assessments').select('*').eq('token_hash', hash).maybeSingle()
      return (data as SessionRow) || null
    },
    // Takes the session's processing lock unless a recent call still holds it.
    async lock(id, staleBeforeIso, nowIso) {
      const { data } = await admin.from('gap_assessments').update({ processing_since: nowIso })
        .eq('id', id).or(`processing_since.is.null,processing_since.lt.${staleBeforeIso}`).select('id')
      return Array.isArray(data) && data.length > 0
    },
    async unlock(id) {
      await admin.from('gap_assessments').update({ processing_since: null }).eq('id', id)
    },
    async updateSession(id, patch) {
      const { error } = await admin.from('gap_assessments').update(patch).eq('id', id)
      if (error) fail('update session', error)
    },
    async messages(id) {
      const { data } = await admin.from('gap_assessment_messages').select('role, content').eq('assessment_id', id).order('seq')
      return data || []
    },
    async addMessages(id, startSeq, msgs) {
      const rows = msgs.map((m, i) => ({ assessment_id: id, seq: startSeq + i, role: m.role, content: m.content }))
      const { error } = await admin.from('gap_assessment_messages').insert(rows)
      if (error) fail('save messages', error)
    },
    async createInquiry(row) {
      let { data, error } = await admin.from('inquiries').insert(row).select('id').single()
      // migration-website-leads.sql / migration-gap-assessments.sql not run yet: keep the enquiry, drop the extras.
      if (error && /column|schema cache|offer_check|staff_band/i.test(error.message || '')) {
        const { offer: _offer, staff_band: _band, ...base } = row
        ;({ data, error } = await admin.from('inquiries').insert(base).select('id').single())
      }
      if (error) fail('create inquiry', error)
      return data?.id ?? null
    },
    async staffEmails() {
      const staff = await staffWithModule(admin, 'assessments', ['admin', 'sales'], 'email')
      return staff.map((p: any) => p.email).filter(Boolean)
    },
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req)
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405)

  try {
    const body = await req.json().catch(() => null)
    const admin = adminClient()
    const ip = await ipHash(req)
    const result = await handleGapRequest(body, {
      store: supabaseStore(admin, ip),
      resolver: makeResolver(),
      fetchImpl: fetch,
      geminiKey: Deno.env.get('GEMINI_API_KEY'),
      ipHash: ip,
      sendEmail: async (to, subject, html) => { requireResendKey(); await sendViaResend(to, subject, html) },
    })
    return json(req, result.body, result.status)
  } catch (err) {
    console.error('[gap-assessment]', err)
    return json(req, { error: 'server_error' }, 500)
  }
})
