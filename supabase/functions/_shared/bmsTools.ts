// The BMS tools Claude can call through the connector (bms-mcp). Every tool
// runs as the signed-in person: it checks their Settings → Permissions
// modules (and admin-only rules) before reading or changing anything, and
// uses the same engines as the app (publisher, connectors, alerts).

import { userHasModule } from './access.ts'
import { claimPosts, countAttempt, isAutomated, publishPost } from './publisher.ts'
import { getConnector, hasConnector } from './platforms/index.ts'
import { upcomingSlots } from './zoned.ts'

// deno-lint-ignore no-explicit-any
type Db = any
export interface Ctx { db: Db; user: { id: string; name: string; email: string; role: string } }
// deno-lint-ignore no-explicit-any
type Args = Record<string, any>

export class ToolError extends Error {}

const PIPELINE_STAGES = ['Scheduled', 'Call Done', 'Questions Prep', 'Questions Sent', 'Responses In', 'Report Prep', 'Presented', 'Contract Out', 'Converted']
const SOCIAL_READ = ['social_calendar', 'social_composer', 'social_bulk', 'social_library', 'social_approvals', 'social_analytics', 'social_activity']

async function requireModule(ctx: Ctx, modules: string[], what: string) {
  if (ctx.user.role === 'admin') return
  for (const m of modules) if (await userHasModule(ctx.db, ctx.user.id, m, ['admin'])) return
  throw new ToolError(`Your BMS role doesn't have access to ${what}. An admin can change this in Settings → Permissions.`)
}

const iso = (v: unknown, name: string) => {
  if (v === undefined || v === null || v === '') return null
  const d = new Date(String(v))
  if (isNaN(d.getTime())) throw new ToolError(`${name} must be a date/time like 2026-12-01T09:00:00+03:00`)
  return d
}
const clip = (s: unknown, n = 160) => { const t = String(s ?? '').trim(); return t.length > n ? `${t.slice(0, n)}…` : t }
const num = (v: unknown) => Number(v) || 0

// ── Platform rules (mirror of src/lib/platforms.js) ─────────────
const RULES: Record<string, { name: string; caption: number; types: string[]; images: number; requiresMedia?: boolean; jpegOnly?: boolean; hashtags?: number }> = {
  linkedin: { name: 'LinkedIn', caption: 3000, types: ['text', 'image', 'carousel', 'video', 'poll'], images: 20 },
  facebook: { name: 'Facebook', caption: 63206, types: ['text', 'image', 'video'], images: 10 },
  instagram: { name: 'Instagram', caption: 2200, types: ['image', 'video'], images: 10, requiresMedia: true, jpegOnly: true, hashtags: 30 },
}

function checkForAccount(account: any, p: { text: string; hashtags: string[]; post_type: string; assets: any[]; poll_question?: string; poll_options?: string[] }) {
  const r = RULES[account.platform]
  if (!r) return [`${account.platform} isn't supported yet`]
  const out: string[] = []
  const full = [p.text.trim(), p.hashtags.map((h) => `#${h}`).join(' ')].filter(Boolean).join('\n\n')
  if (!r.types.includes(p.post_type)) out.push(`${r.name} doesn't support ${p.post_type} posts (allowed: ${r.types.join(', ')})`)
  if (full.length > r.caption) out.push(`text is ${full.length - r.caption} characters over ${r.name}'s ${r.caption} limit`)
  if (p.post_type === 'text' && !full) out.push('the post has no text')
  if ((r.requiresMedia || ['image', 'video', 'carousel'].includes(p.post_type)) && !p.assets.length) out.push(`${r.name} needs media — pass media_ids from social_list_media`)
  if (p.post_type === 'image' && p.assets.length > r.images) out.push(`${r.name} allows up to ${r.images} images`)
  if (p.post_type === 'image' && p.assets.some((a) => a.file_type !== 'image')) out.push('image posts can only contain images')
  if (p.post_type === 'video' && p.assets.some((a) => a.file_type !== 'video')) out.push('attach a video file')
  if (p.post_type === 'carousel' && p.assets.some((a) => a.file_type !== 'document')) out.push('document posts need a PDF, PPTX or DOCX')
  if (r.jpegOnly && p.assets.some((a) => a.file_type === 'image' && !/\.jpe?g$/i.test(a.file_name))) out.push(`${r.name} only accepts JPEG images`)
  if (r.hashtags && p.hashtags.length > r.hashtags) out.push(`${r.name} allows at most ${r.hashtags} hashtags`)
  if (p.post_type === 'poll') {
    if (!p.poll_question?.trim()) out.push('add poll_question')
    const opts = (p.poll_options || []).filter(Boolean)
    if (opts.length < 2 || opts.length > 4) out.push('a poll needs 2–4 poll_options')
    if (opts.some((o) => o.length > 30)) out.push('poll options must be 30 characters or fewer')
  }
  return out
}

async function postableAccounts(ctx: Ctx) {
  const { data } = await ctx.db.from('connected_accounts').select('*').eq('status', 'active')
  return (data || []).filter((a: any) => a.account_type !== 'member' || a.owner_profile_id === ctx.user.id)
}

async function nextSlot(db: Db, account: any): Promise<Date | null> {
  const { data: slots } = await db.from('posting_slots').select('weekday, slot_time').eq('account_id', account.id).eq('active', true)
  if (!slots?.length) return null
  const from = new Date(Date.now() + 10 * 60 * 1000)
  const to = new Date(Date.now() + 60 * 86400000)
  const { data: taken } = await db.from('posts').select('scheduled_at').eq('account_id', account.id).eq('is_template', false)
    .in('status', ['scheduled', 'pending_approval', 'publishing', 'ready_to_post']).gte('scheduled_at', from.toISOString()).lte('scheduled_at', to.toISOString())
  const takenMin = new Set((taken || []).map((p: any) => Math.floor(new Date(p.scheduled_at).getTime() / 60000)))
  return upcomingSlots(slots.map((s: any) => ({ weekday: s.weekday, time: String(s.slot_time).slice(0, 5) })), account.timezone || 'Africa/Nairobi', from, to)
    .find((d) => !takenMin.has(Math.floor(d.getTime() / 60000))) || null
}

function summarizePost(p: any, accounts: Record<string, any> = {}) {
  const a = accounts[p.account_id]
  return {
    post_id: p.id, group_id: p.post_group_id, account: a ? `${a.platform}: ${a.account_name}` : p.account_id,
    status: p.status, post_type: p.post_type, scheduled_at: p.scheduled_at, posted_at: p.posted_at,
    text: clip(p.caption, 280), url: p.external_post_url || undefined, error: p.publish_error || undefined,
    origin: p.origin === 'imported' ? 'published directly on the network' : undefined,
  }
}

// ── Tool definitions ────────────────────────────────────────────

export interface Tool {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: Record<string, unknown>
  run: (ctx: Ctx, args: Args) => Promise<unknown>
}

const READ = { readOnlyHint: true, openWorldHint: false }
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
const PUBLIC = { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false })
const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: 'string', description, ...extra })

export const TOOLS: Tool[] = [
  // ── Social media ──
  {
    name: 'social_list_accounts', title: 'List social accounts', annotations: READ,
    description: 'Social accounts you can post as (LinkedIn Company Pages and your profile, Facebook Pages, Instagram). Use the ids with other social tools.',
    inputSchema: obj({}),
    async run(ctx) {
      await requireModule(ctx, SOCIAL_READ, 'social media')
      return (await postableAccounts(ctx)).map((a: any) => ({
        account_id: a.id, platform: a.platform, name: a.account_name, kind: a.account_type,
        publishing: a.mode === 'automated' ? 'automatic' : 'manual (assisted)', last_synced_at: a.last_synced_at,
      }))
    },
  },
  {
    name: 'social_list_posts', title: 'List planned and published posts', annotations: READ,
    description: 'Posts in the planner between two dates (default: past 7 days to next 30 days). Filter by status: draft, pending_approval, scheduled, publishing, ready_to_post, posted, failed.',
    inputSchema: obj({ from: str('Start date/time (ISO)'), to: str('End date/time (ISO)'), status: str('Optional status filter'), account_id: str('Optional account id') }),
    async run(ctx, a) {
      await requireModule(ctx, SOCIAL_READ, 'social media')
      const from = iso(a.from, 'from') || new Date(Date.now() - 7 * 86400000)
      const to = iso(a.to, 'to') || new Date(Date.now() + 30 * 86400000)
      let q = ctx.db.from('posts').select('*').eq('is_template', false).gte('scheduled_at', from.toISOString()).lte('scheduled_at', to.toISOString()).order('scheduled_at').limit(200)
      if (a.status) q = q.eq('status', a.status)
      if (a.account_id) q = q.eq('account_id', a.account_id)
      const { data } = await q
      const { data: accs } = await ctx.db.from('connected_accounts').select('id, platform, account_name')
      const map = Object.fromEntries((accs || []).map((x: any) => [x.id, x]))
      const { data: drafts } = await ctx.db.from('posts').select('*').eq('is_template', false).eq('status', 'draft').is('scheduled_at', null).order('updated_at', { ascending: false }).limit(20)
      return { posts: (data || []).map((p: any) => summarizePost(p, map)), unscheduled_drafts: (drafts || []).map((p: any) => summarizePost(p, map)) }
    },
  },
  {
    name: 'social_get_post', title: 'Get a post', annotations: READ,
    description: 'Full details of one post, its sibling posts on other accounts (same group), media and latest stats.',
    inputSchema: obj({ post_id: str('Post id') }, ['post_id']),
    async run(ctx, a) {
      await requireModule(ctx, SOCIAL_READ, 'social media')
      const { data: p } = await ctx.db.from('posts').select('*').eq('id', a.post_id).maybeSingle()
      if (!p) throw new ToolError('Post not found')
      const { data: sibs } = await ctx.db.from('posts').select('*').eq('post_group_id', p.post_group_id).eq('is_template', false)
      const { data: accs } = await ctx.db.from('connected_accounts').select('id, platform, account_name')
      const map = Object.fromEntries((accs || []).map((x: any) => [x.id, x]))
      const { data: media } = await ctx.db.from('post_assets').select('content_assets(id, file_name, file_type)').eq('post_id', p.id).order('position')
      return {
        ...summarizePost(p, map), text: p.caption, hashtags: p.hashtags, first_comment: p.first_comment, link: p.utm_url,
        poll: p.post_type === 'poll' ? { question: p.poll_question, options: (p.poll_options || []).map((o: any) => o.text || o) } : undefined,
        recurrence: p.recurrence || undefined, lifetime_stats: p.last_stats || undefined,
        media: (media || []).map((m: any) => m.content_assets),
        group: (sibs || []).map((s: any) => summarizePost(s, map)),
      }
    },
  },
  {
    name: 'social_list_media', title: 'Search the Content Library', annotations: READ,
    description: 'Images, videos and documents in the Content Library (newest first). Use their ids as media_ids when creating posts. Upload new files in the BMS Library.',
    inputSchema: obj({ search: str('Optional text in the file name or tags'), type: str('Optional: image, video or document') }),
    async run(ctx, a) {
      await requireModule(ctx, ['social_library', 'social_composer', 'social_calendar'], 'the Content Library')
      let q = ctx.db.from('content_assets').select('id, file_name, file_type, tags, created_at').order('created_at', { ascending: false }).limit(50)
      if (a.type) q = q.eq('file_type', a.type)
      if (a.search) q = q.ilike('file_name', `%${a.search}%`)
      const { data } = await q
      return data || []
    },
  },
  {
    name: 'social_create_post', title: 'Create a post', annotations: PUBLIC,
    description: 'Create one post for one or more accounts (one row per account, shared group). when: "draft" (save only), "schedule" (needs schedule_at), "queue" (next free slot of each account\'s posting schedule) or "now" (publish immediately). If approvals are switched on and you are not an admin, scheduled posts go to the approval queue instead. Always confirm text, accounts and timing with the user before publishing.',
    inputSchema: obj({
      account_ids: { type: 'array', items: { type: 'string' }, description: 'From social_list_accounts' },
      text: str('Post text (shared by all accounts)'),
      text_per_account: { type: 'object', additionalProperties: { type: 'string' }, description: 'Optional: account_id → different text for that account' },
      hashtags: { type: 'array', items: { type: 'string' }, description: 'Without #' },
      post_type: str('text, image, carousel (LinkedIn document), video or poll', { enum: ['text', 'image', 'carousel', 'video', 'poll'] }),
      media_ids: { type: 'array', items: { type: 'string' }, description: 'Content Library ids (social_list_media)' },
      first_comment: str('Optional comment posted right after publishing'),
      link: str('Optional tracked link (Facebook uses it as the link preview)'),
      poll_question: str('Poll only'), poll_options: { type: 'array', items: { type: 'string' } },
      when: str('draft, schedule, queue or now', { enum: ['draft', 'schedule', 'queue', 'now'] }),
      schedule_at: str('ISO date/time, for when = schedule (e.g. 2026-12-01T09:00:00+03:00)'),
      repeat: { type: 'object', description: 'Optional repeat: { freq: daily|weekly|monthly, interval: number, until?: YYYY-MM-DD }' },
    }, ['account_ids', 'when']),
    async run(ctx, a) {
      await requireModule(ctx, ['social_composer', 'social_calendar', 'social_bulk'], 'creating posts')
      const all = await postableAccounts(ctx)
      const accounts = all.filter((x: any) => (a.account_ids || []).includes(x.id))
      if (!accounts.length) throw new ToolError('None of those accounts can be posted to by you — use social_list_accounts')
      const postType = a.post_type || ((a.media_ids || []).length ? 'image' : 'text')
      const hashtags = (a.hashtags || []).map((h: string) => String(h).replace(/^#/, '').trim()).filter(Boolean)
      let assets: any[] = []
      if ((a.media_ids || []).length) {
        const { data } = await ctx.db.from('content_assets').select('id, file_name, file_type').in('id', a.media_ids)
        assets = (a.media_ids as string[]).map((id) => (data || []).find((d: any) => d.id === id)).filter(Boolean)
        if (assets.length !== a.media_ids.length) throw new ToolError('Some media_ids were not found in the Content Library')
      }
      const textFor = (acc: any) => String(a.text_per_account?.[acc.id] ?? a.text ?? '')
      const problems = accounts.flatMap((acc: any) => checkForAccount(acc, { text: textFor(acc), hashtags, post_type: postType, assets, poll_question: a.poll_question, poll_options: a.poll_options }).map((m) => `${acc.account_name}: ${m}`))
      if (problems.length) throw new ToolError(`Can't create this post — ${problems.join('; ')}`)

      // When
      const times: Record<string, string | null> = {}
      if (a.when === 'schedule') {
        const at = iso(a.schedule_at, 'schedule_at')
        if (!at || at.getTime() < Date.now()) throw new ToolError('schedule_at must be a future date/time')
        accounts.forEach((acc: any) => { times[acc.id] = at.toISOString() })
      } else if (a.when === 'queue') {
        for (const acc of accounts) {
          const slot = await nextSlot(ctx.db, acc)
          if (!slot) throw new ToolError(`${acc.account_name} has no posting schedule — set one in Planner → Posting schedule, or use when = schedule`)
          times[acc.id] = slot.toISOString()
        }
      } else if (a.when === 'now') {
        accounts.forEach((acc: any) => { times[acc.id] = new Date().toISOString() })
      } else {
        accounts.forEach((acc: any) => { times[acc.id] = a.schedule_at ? iso(a.schedule_at, 'schedule_at')!.toISOString() : null })
      }

      const { data: approval } = await ctx.db.from('system_settings').select('value').eq('key', 'sm_approval_workflow_enabled').maybeSingle()
      const needsApproval = approval?.value === 'true' && ctx.user.role !== 'admin' && a.when !== 'draft'
      const status = a.when === 'draft' ? 'draft' : needsApproval ? 'pending_approval' : 'scheduled'
      const groupId = crypto.randomUUID()
      const rows: any[] = []
      for (const acc of accounts) {
        const { data: row, error } = await ctx.db.from('posts').insert({
          account_id: acc.id, post_type: postType, caption: textFor(acc), hashtags, mentions: [],
          utm_url: a.link || null, mode: acc.mode, first_comment: a.first_comment || null,
          poll_question: postType === 'poll' ? a.poll_question : null,
          poll_options: postType === 'poll' ? (a.poll_options || []).filter(Boolean).map((text: string) => ({ text })) : null,
          recurrence: a.repeat?.freq ? { freq: a.repeat.freq, interval: Number(a.repeat.interval) || 1, until: a.repeat.until || null } : null,
          status, scheduled_at: times[acc.id], post_group_id: groupId, created_by: ctx.user.id,
        }).select('*').single()
        if (error) throw new ToolError(`${acc.account_name}: ${error.message}`)
        if (assets.length) await ctx.db.from('post_assets').insert(assets.map((x, i) => ({ post_id: row.id, asset_id: x.id, position: i })))
        rows.push(row)
      }

      if (needsApproval) {
        await ctx.db.from('post_approval_history').insert({ post_id: rows[0].id, action: 'submitted', actor_id: ctx.user.id })
        await notify('sm-notify-event', { event: 'approval_requested', post_id: rows[0].id, actor_id: ctx.user.id })
        return { result: 'Submitted for approval (approvals are switched on)', posts: rows.map((r) => summarizePost(r)) }
      }

      if (a.when === 'now') {
        const outcome = []
        for (const row of rows) {
          const acc = accounts.find((x: any) => x.id === row.account_id)
          if (!isAutomated(acc)) {
            await ctx.db.from('posts').update({ status: 'ready_to_post' }).eq('id', row.id)
            outcome.push({ account: acc.account_name, result: 'Ready to post — this account publishes manually; post it from the Planner' })
            continue
          }
          const claimed = await claimPosts(ctx.db, [row.id], ['scheduled'])
          if (!claimed.length) { outcome.push({ account: acc.account_name, result: 'already being published' }); continue }
          await countAttempt(ctx.db, row.id)
          const r = await publishPost(ctx.db, row.id)
          outcome.push({ account: acc.account_name, result: r.result, url: r.result === 'posted' ? r.url : undefined, detail: r.result === 'failed' ? r.error : r.result === 'pending' ? r.reason : undefined })
        }
        return { group_id: groupId, published: outcome }
      }
      return { result: status === 'draft' ? 'Saved as draft' : 'Scheduled', group_id: groupId, posts: rows.map((r) => summarizePost(r)) }
    },
  },
  {
    name: 'social_update_post', title: 'Edit a post', annotations: WRITE,
    description: 'Change a post that is not yet published: text, hashtags, first comment, time (schedule_at) or status (draft/scheduled). apply_to_group = true applies the change to the same post on every account.',
    inputSchema: obj({
      post_id: str('Post id'), text: str('New text'), hashtags: { type: 'array', items: { type: 'string' } },
      first_comment: str('New first comment ("" to remove)'), schedule_at: str('New ISO date/time'),
      status: str('draft or scheduled', { enum: ['draft', 'scheduled'] }), apply_to_group: { type: 'boolean' },
    }, ['post_id']),
    async run(ctx, a) {
      await requireModule(ctx, ['social_composer', 'social_calendar'], 'editing posts')
      const { data: p } = await ctx.db.from('posts').select('*').eq('id', a.post_id).maybeSingle()
      if (!p) throw new ToolError('Post not found')
      const targets = a.apply_to_group
        ? ((await ctx.db.from('posts').select('*').eq('post_group_id', p.post_group_id).eq('is_template', false)).data || [])
        : [p]
      const locked = targets.filter((t: any) => ['posted', 'publishing'].includes(t.status))
      if (locked.length) throw new ToolError('Published posts can\'t be edited — create a new post instead')
      const patch: Args = {}
      if (a.text !== undefined) patch.caption = a.text
      if (a.hashtags !== undefined) patch.hashtags = a.hashtags.map((h: string) => String(h).replace(/^#/, ''))
      if (a.first_comment !== undefined) patch.first_comment = a.first_comment || null
      if (a.schedule_at !== undefined) {
        const at = iso(a.schedule_at, 'schedule_at')
        if (at && at.getTime() < Date.now()) throw new ToolError('schedule_at must be in the future')
        patch.scheduled_at = at?.toISOString() || null
      }
      if (a.status) {
        const { data: approval } = await ctx.db.from('system_settings').select('value').eq('key', 'sm_approval_workflow_enabled').maybeSingle()
        if (a.status === 'scheduled' && approval?.value === 'true' && ctx.user.role !== 'admin') throw new ToolError('Approvals are on — an admin must approve scheduling (or submit it in the BMS)')
        patch.status = a.status
        if (a.status === 'scheduled') { patch.publish_error = null; patch.publish_state = null }
      }
      if (patch.status === 'scheduled' && !(patch.scheduled_at || p.scheduled_at)) throw new ToolError('Give schedule_at to schedule it')
      for (const t of targets) {
        const { error } = await ctx.db.from('posts').update(patch).eq('id', t.id)
        if (error) throw new ToolError(error.message)
      }
      return { updated: targets.length }
    },
  },
  {
    name: 'social_delete_post', title: 'Delete a post', annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    description: 'Delete an unpublished post from the BMS (all accounts in its group when apply_to_group = true). Published posts stay on the network; this tool will not delete them.',
    inputSchema: obj({ post_id: str('Post id'), apply_to_group: { type: 'boolean' } }, ['post_id']),
    async run(ctx, a) {
      await requireModule(ctx, ['social_calendar', 'social_composer'], 'deleting posts')
      const { data: p } = await ctx.db.from('posts').select('id, post_group_id, status').eq('id', a.post_id).maybeSingle()
      if (!p) throw new ToolError('Post not found')
      let q = ctx.db.from('posts').delete().not('status', 'in', '(posted,publishing)').eq('is_template', false)
      q = a.apply_to_group ? q.eq('post_group_id', p.post_group_id) : q.eq('id', p.id)
      const { data, error } = await q.select('id')
      if (error) throw new ToolError(error.message)
      return { deleted: data?.length || 0 }
    },
  },
  {
    name: 'social_publish_post', title: 'Publish or retry a post now', annotations: PUBLIC,
    description: 'Publish an existing scheduled, failed or ready post immediately on its network. Confirm with the user first.',
    inputSchema: obj({ post_id: str('Post id') }, ['post_id']),
    async run(ctx, a) {
      await requireModule(ctx, ['social_calendar'], 'publishing')
      const { data: p } = await ctx.db.from('posts').select('*, connected_accounts(*)').eq('id', a.post_id).maybeSingle()
      if (!p) throw new ToolError('Post not found')
      const acc = p.connected_accounts
      if (acc?.account_type === 'member' && acc.owner_profile_id !== ctx.user.id) throw new ToolError('Only the profile owner can publish to it')
      if (!isAutomated(acc)) throw new ToolError(`${acc?.account_name || 'This account'} publishes manually — post it from the Planner`)
      if (p.status === 'failed') await ctx.db.from('posts').update({ publish_state: null, publish_error: null }).eq('id', p.id)
      const claimed = await claimPosts(ctx.db, [p.id], ['failed', 'scheduled', 'ready_to_post', 'draft'])
      if (!claimed.length) throw new ToolError(p.status === 'posted' ? 'Already published' : 'It is already being published')
      await countAttempt(ctx.db, p.id)
      const r = await publishPost(ctx.db, p.id)
      return r
    },
  },
  {
    name: 'social_analytics', title: 'Social media analytics', annotations: READ,
    description: 'Totals for a period compared with the period before (impressions, engagements, rate, clicks, posts, followers) and the top posts. Default: last 28 days, all accounts.',
    inputSchema: obj({ from: str('Start (ISO)'), to: str('End (ISO)'), account_ids: { type: 'array', items: { type: 'string' } } }),
    async run(ctx, a) {
      await requireModule(ctx, ['social_analytics', 'social_reports'], 'social analytics')
      const to = iso(a.to, 'to') || new Date()
      const from = iso(a.from, 'from') || new Date(to.getTime() - 28 * 86400000)
      const prevFrom = new Date(from.getTime() - (to.getTime() - from.getTime()))
      const { data: accs } = await ctx.db.from('connected_accounts').select('id, platform, account_name').eq('status', 'active')
      const ids = (a.account_ids?.length ? a.account_ids : (accs || []).map((x: any) => x.id)) as string[]
      const { data: snaps } = await ctx.db.from('analytics_snapshots').select('*').is('post_id', null).in('account_id', ids).gte('captured_at', prevFrom.toISOString()).lte('captured_at', to.toISOString())
      const sum = (f: Date, t: Date) => {
        const rows = (snaps || []).filter((s: any) => new Date(s.captured_at) >= f && new Date(s.captured_at) < t)
        const imp = rows.reduce((x: number, s: any) => x + num(s.impressions), 0)
        const eng = rows.reduce((x: number, s: any) => x + num(s.reactions) + num(s.comments) + num(s.shares), 0)
        return { impressions: imp, engagements: eng, engagement_rate_pct: imp ? +(eng / imp * 100).toFixed(2) : 0, clicks: rows.reduce((x: number, s: any) => x + num(s.clicks), 0) }
      }
      const followers: Record<string, number | null> = {}
      for (const id of ids) {
        const { data } = await ctx.db.from('analytics_snapshots').select('follower_count').eq('account_id', id).is('post_id', null).not('follower_count', 'is', null).order('captured_at', { ascending: false }).limit(1).maybeSingle()
        const acc = (accs || []).find((x: any) => x.id === id)
        if (acc) followers[`${acc.platform}: ${acc.account_name}`] = data?.follower_count ?? null
      }
      const { data: posts } = await ctx.db.from('posts').select('id, account_id, caption, post_type, posted_at, external_post_url, last_stats').eq('status', 'posted').in('account_id', ids).gte('posted_at', from.toISOString()).lte('posted_at', to.toISOString())
      const top = (posts || []).map((p: any) => {
        const s = p.last_stats || {}
        return { text: clip(p.caption, 120), posted_at: p.posted_at, type: p.post_type, url: p.external_post_url, impressions: num(s.impressions), engagements: num(s.reactions) + num(s.comments) + num(s.shares), clicks: num(s.clicks) }
      }).sort((x: any, y: any) => y.engagements - x.engagements).slice(0, 5)
      return { period: { from, to }, current: sum(from, to), previous: sum(prevFrom, from), posts_published: (posts || []).length, followers, top_posts: top }
    },
  },
  {
    name: 'social_list_comments', title: 'Inbox: list comments', annotations: READ,
    description: 'Comments and activity from the Inbox (default: waiting for a response), newest first.',
    inputSchema: obj({ status: str('needs_response (default), handled, ignored or all'), limit: { type: 'number' } }),
    async run(ctx, a) {
      await requireModule(ctx, ['social_activity'], 'the Inbox')
      let q = ctx.db.from('activity_events').select('id, event_type, direction, author_name, content, occurred_at, triage_status, external_url, external_id, posts(caption), connected_accounts(platform, account_name)')
        .neq('direction', 'outbound').order('occurred_at', { ascending: false }).limit(Math.min(num(a.limit) || 30, 100))
      if (a.status !== 'all') q = q.eq('triage_status', a.status || 'needs_response')
      const { data } = await q
      return (data || []).map((e: any) => ({
        event_id: e.id, type: e.event_type, account: e.connected_accounts ? `${e.connected_accounts.platform}: ${e.connected_accounts.account_name}` : null,
        from: e.author_name, text: e.content, at: e.occurred_at, status: e.triage_status, on_post: clip(e.posts?.caption, 100),
        can_reply: !!e.external_id && e.event_type === 'comment', url: e.external_url,
      }))
    },
  },
  {
    name: 'social_reply_comment', title: 'Inbox: reply to a comment', annotations: PUBLIC,
    description: 'Post a public reply to a synced comment, as the account (e.g. the Company Page). Confirm the reply text with the user first.',
    inputSchema: obj({ event_id: str('From social_list_comments'), text: str('Reply text') }, ['event_id', 'text']),
    async run(ctx, a) {
      await requireModule(ctx, ['social_activity'], 'the Inbox')
      const text = String(a.text || '').trim()
      if (!text) throw new ToolError('Write a reply')
      const { data: e } = await ctx.db.from('activity_events').select('*, posts(external_post_urn), connected_accounts(*)').eq('id', a.event_id).maybeSingle()
      if (!e || e.event_type !== 'comment' || !e.external_id) throw new ToolError('Only comments synced from a network can be answered')
      const acc = e.connected_accounts
      if (!acc || !hasConnector(acc.platform) || !e.posts?.external_post_urn) throw new ToolError('This comment\'s account is not connected')
      const c = getConnector(acc.platform)
      if (!c.capabilities(acc).reply || !c.replyToComment) throw new ToolError(`Replying isn't available for ${acc.account_name}`)
      const token = await c.getToken(ctx.db, acc)
      const parent = e.parent_external_id || e.external_id
      const replyId = await c.replyToComment(token, acc, e.posts.external_post_urn, parent, text)
      const now = new Date().toISOString()
      await ctx.db.from('activity_events').insert({ account_id: acc.id, post_id: e.post_id, event_type: 'comment', direction: 'outbound', content: text, author_name: acc.account_name, occurred_at: now, external_url: e.external_url, external_id: replyId || null, parent_external_id: parent, source: 'api', triage_status: 'handled', created_by: ctx.user.id })
      await ctx.db.from('activity_events').update({ triage_status: 'handled', replied_at: now }).eq('id', e.id)
      return { result: 'Reply posted', on: acc.account_name }
    },
  },
  {
    name: 'social_mark_comment', title: 'Inbox: mark a comment', annotations: WRITE,
    description: 'Set an Inbox item to handled, ignored or needs_response.',
    inputSchema: obj({ event_id: str('Event id'), status: str('handled, ignored or needs_response', { enum: ['handled', 'ignored', 'needs_response'] }) }, ['event_id', 'status']),
    async run(ctx, a) {
      await requireModule(ctx, ['social_activity'], 'the Inbox')
      const { error } = await ctx.db.from('activity_events').update({ triage_status: a.status }).eq('id', a.event_id)
      if (error) throw new ToolError(error.message)
      return { result: 'Updated' }
    },
  },

  // ── Sales ──
  {
    name: 'sales_search_leads', title: 'Search leads', annotations: READ,
    description: 'Search leads by name, company or email, and/or filter by pipeline stage or classification (hot, warm, cold). Lost and disqualified leads are excluded unless include_closed = true.',
    inputSchema: obj({ query: str('Text to search'), stage: str(`One of: ${PIPELINE_STAGES.join(', ')}`), classification: str('hot, warm or cold'), include_closed: { type: 'boolean' }, limit: { type: 'number' } }),
    async run(ctx, a) {
      await requireModule(ctx, ['leads', 'pipeline', 'dashboard'], 'leads')
      let q = ctx.db.from('leads').select('id, full_name, company_name, email, phone, classification, current_stage, is_lost, is_disqualified, scheduled_date, scheduled_time, source, total_score, created_at')
        .order('created_at', { ascending: false }).limit(Math.min(num(a.limit) || 25, 100))
      if (a.query) { const t = String(a.query).replace(/[,()]/g, ' '); q = q.or(`full_name.ilike.%${t}%,company_name.ilike.%${t}%,email.ilike.%${t}%`) }
      if (a.stage) q = q.eq('current_stage', a.stage)
      if (a.classification) q = q.eq('classification', a.classification)
      if (!a.include_closed) q = q.eq('is_lost', false).eq('is_disqualified', false)
      const { data } = await q
      return data || []
    },
  },
  {
    name: 'sales_get_lead', title: 'Get a lead', annotations: READ,
    description: 'Everything about one lead: contact, answers and score, stage, stage history and notes.',
    inputSchema: obj({ lead_id: str('Lead id') }, ['lead_id']),
    async run(ctx, a) {
      await requireModule(ctx, ['leads', 'pipeline', 'dashboard'], 'leads')
      const { data: lead } = await ctx.db.from('leads').select('*').eq('id', a.lead_id).maybeSingle()
      if (!lead) throw new ToolError('Lead not found')
      const [{ data: notes }, { data: history }] = await Promise.all([
        ctx.db.from('lead_notes').select('note, created_at, profiles(name)').eq('lead_id', lead.id).order('created_at', { ascending: false }),
        ctx.db.from('lead_stage_history').select('stage, entered_at, profiles(name)').eq('lead_id', lead.id).order('entered_at'),
      ])
      return { lead, notes: (notes || []).map((n: any) => ({ note: n.note, at: n.created_at, by: n.profiles?.name })), stage_history: (history || []).map((h: any) => ({ stage: h.stage, at: h.entered_at, by: h.profiles?.name })) }
    },
  },
  {
    name: 'sales_add_lead_note', title: 'Add a note to a lead', annotations: WRITE,
    description: 'Add a note to a lead\'s record.',
    inputSchema: obj({ lead_id: str('Lead id'), note: str('The note') }, ['lead_id', 'note']),
    async run(ctx, a) {
      await requireModule(ctx, ['leads', 'pipeline'], 'editing leads')
      if (!String(a.note || '').trim()) throw new ToolError('Write a note')
      const { error } = await ctx.db.from('lead_notes').insert({ lead_id: a.lead_id, note: String(a.note).trim(), created_by: ctx.user.id })
      if (error) throw new ToolError(error.message)
      return { result: 'Note added' }
    },
  },
  {
    name: 'sales_move_lead', title: 'Move a lead to another stage', annotations: WRITE,
    description: `Move a lead to a pipeline stage (${PIPELINE_STAGES.join(' → ')}), or mark it lost with lost_reason. Records the stage history and sends the usual stage alerts.`,
    inputSchema: obj({ lead_id: str('Lead id'), stage: str('Target stage', { enum: [...PIPELINE_STAGES, 'Lost'] }), lost_reason: str('Required when stage = Lost'), note: str('Optional note to add') }, ['lead_id', 'stage']),
    async run(ctx, a) {
      await requireModule(ctx, ['pipeline', 'leads'], 'the sales pipeline')
      const { data: lead } = await ctx.db.from('leads').select('id, full_name, current_stage, is_lost').eq('id', a.lead_id).maybeSingle()
      if (!lead) throw new ToolError('Lead not found')
      if (a.stage === 'Lost') {
        if (!String(a.lost_reason || '').trim()) throw new ToolError('Give lost_reason')
        await ctx.db.from('leads').update({ is_lost: true, lost_reason: String(a.lost_reason).trim() }).eq('id', lead.id)
        await ctx.db.from('lead_stage_history').insert({ lead_id: lead.id, stage: 'Lost', moved_by: ctx.user.id })
        await notify('notify-lead-stage', { lead_id: lead.id, event: 'lost' })
      } else {
        if (lead.current_stage === a.stage && !lead.is_lost) return { result: `Already in ${a.stage}` }
        await ctx.db.from('leads').update({ current_stage: a.stage, is_lost: false }).eq('id', lead.id)
        await ctx.db.from('lead_stage_history').insert({ lead_id: lead.id, stage: a.stage, moved_by: ctx.user.id })
        await notify('notify-lead-stage', { lead_id: lead.id, event: 'stage_changed', previous_stage: lead.current_stage })
      }
      if (String(a.note || '').trim()) await ctx.db.from('lead_notes').insert({ lead_id: lead.id, note: String(a.note).trim(), created_by: ctx.user.id })
      return { result: `${lead.full_name} moved to ${a.stage}` }
    },
  },
  {
    name: 'sales_upcoming_calls', title: 'Upcoming discovery calls', annotations: READ,
    description: 'Booked discovery calls in the next N days (default 7).',
    inputSchema: obj({ days: { type: 'number' } }),
    async run(ctx, a) {
      await requireModule(ctx, ['pipeline', 'leads', 'dashboard'], 'leads')
      const today = new Date().toISOString().slice(0, 10)
      const until = new Date(Date.now() + (num(a.days) || 7) * 86400000).toISOString().slice(0, 10)
      const { data } = await ctx.db.from('leads').select('id, full_name, company_name, phone, email, scheduled_date, scheduled_time, current_stage, classification')
        .gte('scheduled_date', today).lte('scheduled_date', until).eq('is_lost', false).order('scheduled_date')
      return data || []
    },
  },
  {
    name: 'sales_list_inquiries', title: 'List inquiries', annotations: READ,
    description: 'Inquiries (people who reached out but are not leads yet). Default: open ones (new, contacted, engaged).',
    inputSchema: obj({ status: str('new, contacted, engaged, converted, closed or all'), query: str('Name, company or email'), limit: { type: 'number' } }),
    async run(ctx, a) {
      await requireModule(ctx, ['inquiries'], 'inquiries')
      let q = ctx.db.from('inquiries').select('id, full_name, company_name, email, phone, channel, message, status, next_follow_up, received_at, last_contact_at')
        .order('received_at', { ascending: false }).limit(Math.min(num(a.limit) || 30, 100))
      if (!a.status) q = q.in('status', ['new', 'contacted', 'engaged'])
      else if (a.status !== 'all') q = q.eq('status', a.status)
      if (a.query) { const t = String(a.query).replace(/[,()]/g, ' '); q = q.or(`full_name.ilike.%${t}%,company_name.ilike.%${t}%,email.ilike.%${t}%`) }
      const { data } = await q
      return data || []
    },
  },
  {
    name: 'sales_update_inquiry', title: 'Update an inquiry', annotations: WRITE,
    description: 'Log activity on an inquiry (note, call, whatsapp, email, meeting) and/or change its status. Closing needs close_reason (no_response, not_a_fit, not_interested, duplicate, spam, other).',
    inputSchema: obj({
      inquiry_id: str('Inquiry id'), activity: str('note, call, whatsapp, email or meeting', { enum: ['note', 'call', 'whatsapp', 'email', 'meeting'] }), body: str('What happened'),
      status: str('new, contacted, engaged, converted or closed', { enum: ['new', 'contacted', 'engaged', 'converted', 'closed'] }), close_reason: str('When closing'), next_follow_up: str('YYYY-MM-DD'),
    }, ['inquiry_id']),
    async run(ctx, a) {
      await requireModule(ctx, ['inquiries'], 'inquiries')
      if (a.activity) {
        const { error } = await ctx.db.from('inquiry_activities').insert({ inquiry_id: a.inquiry_id, kind: a.activity, body: a.body || null, created_by: ctx.user.id })
        if (error) throw new ToolError(error.message)
      }
      const patch: Args = {}
      if (a.status) {
        patch.status = a.status
        if (a.status === 'closed') {
          if (!a.close_reason) throw new ToolError('Give close_reason to close an inquiry')
          patch.close_reason = a.close_reason; patch.closed_at = new Date().toISOString()
        }
        if (a.status === 'converted') patch.converted_at = new Date().toISOString()
        await ctx.db.from('inquiry_activities').insert({ inquiry_id: a.inquiry_id, kind: 'status', body: `Status → ${a.status}${a.close_reason ? ` (${a.close_reason})` : ''}`, created_by: ctx.user.id })
      }
      if (a.next_follow_up) patch.next_follow_up = a.next_follow_up
      if (Object.keys(patch).length) {
        const { error } = await ctx.db.from('inquiries').update(patch).eq('id', a.inquiry_id)
        if (error) throw new ToolError(error.message)
      }
      return { result: 'Inquiry updated' }
    },
  },

  // ── Reports ──
  {
    name: 'report_pipeline', title: 'Pipeline summary', annotations: READ,
    description: 'Live sales pipeline: leads per stage, hot/warm/cold, new leads and conversions in the last 30 days, lost reasons.',
    inputSchema: obj({}),
    async run(ctx) {
      await requireModule(ctx, ['dashboard', 'pipeline', 'leads', 'lead_analytics'], 'the pipeline')
      const { data } = await ctx.db.from('leads').select('current_stage, classification, is_lost, lost_reason, is_disqualified, created_at')
      const leads = data || []
      const since = Date.now() - 30 * 86400000
      const active = leads.filter((l: any) => !l.is_lost && !l.is_disqualified)
      const count = (arr: any[], key: string) => arr.reduce((m: any, l: any) => { m[l[key]] = (m[l[key]] || 0) + 1; return m }, {})
      return {
        active_by_stage: Object.fromEntries(PIPELINE_STAGES.map((s) => [s, active.filter((l: any) => l.current_stage === s).length])),
        active_by_classification: count(active, 'classification'),
        new_last_30_days: leads.filter((l: any) => new Date(l.created_at).getTime() >= since).length,
        total_converted: leads.filter((l: any) => l.current_stage === 'Converted').length,
        lost: leads.filter((l: any) => l.is_lost).length,
        lost_reasons: count(leads.filter((l: any) => l.is_lost), 'lost_reason'),
      }
    },
  },
  {
    name: 'report_website_traffic', title: 'Website traffic', annotations: READ,
    description: 'Website visits for a period (default last 28 days): sessions by channel and source, top landing pages, devices.',
    inputSchema: obj({ from: str('Start (ISO)'), to: str('End (ISO)') }),
    async run(ctx, a) {
      await requireModule(ctx, ['website_analytics'], 'Website Analytics')
      const to = iso(a.to, 'to') || new Date()
      const from = iso(a.from, 'from') || new Date(to.getTime() - 28 * 86400000)
      const { data } = await ctx.db.from('web_sessions').select('channel, source, landing_path, device_type').gte('started_at', from.toISOString()).lte('started_at', to.toISOString()).limit(50000)
      const rows = data || []
      const top = (key: string, n = 10) => Object.entries(rows.reduce((m: any, r: any) => { const k = r[key] || '(none)'; m[k] = (m[k] || 0) + 1; return m }, {}))
        .sort((x: any, y: any) => y[1] - x[1]).slice(0, n).map(([k, v]) => ({ [key]: k, sessions: v }))
      return { period: { from, to }, sessions: rows.length, by_channel: top('channel'), by_source: top('source'), top_landing_pages: top('landing_path'), devices: top('device_type', 5) }
    },
  },
  {
    name: 'report_assessments', title: 'Automation Scoper results', annotations: READ,
    description: 'Recent free Automation Scoper assessments from the website (who, company, status, date).',
    inputSchema: obj({ limit: { type: 'number' } }),
    async run(ctx, a) {
      await requireModule(ctx, ['assessments'], 'the Automation Scoper')
      const { data } = await ctx.db.from('gap_assessments').select('id, full_name, company_name, email, website_url, status, areas_covered, created_at, report_generated_at')
        .order('created_at', { ascending: false }).limit(Math.min(num(a.limit) || 20, 100))
      return data || []
    },
  },
  {
    name: 'report_ospod_waitlist', title: 'Ospod waitlist', annotations: READ,
    description: 'Ospod waitlist signups: totals by page and source, and the latest signups.',
    inputSchema: obj({ limit: { type: 'number' } }),
    async run(ctx, a) {
      await requireModule(ctx, ['ospod_waitlist'], 'the Ospod waitlist')
      const { data } = await ctx.db.from('ospod_waitlist_signups').select('member_no, email, variant, role, shows, episodes, spend, utm_source, utm_content, created_at').order('created_at', { ascending: false })
      const rows = data || []
      const by = (k: string) => rows.reduce((m: any, r: any) => { const v = r[k] || '(none)'; m[v] = (m[v] || 0) + 1; return m }, {})
      return { total: rows.length, by_page: by('variant'), by_source: by('utm_source'), latest: rows.slice(0, Math.min(num(a.limit) || 10, 50)) }
    },
  },
]

// Fire an existing alert function as the service (same alerts as the app).
async function notify(fn: string, body: Record<string, unknown>) {
  await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
    body: JSON.stringify(body),
  }).catch((e) => console.warn(`[bms-mcp] ${fn}:`, e.message))
}
