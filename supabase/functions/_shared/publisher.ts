// Platform-neutral publishing engine, used by sm-move-to-ready (cron) and
// sm-publish (Retry / Publish now). It claims a post, loads its media, hands
// it to the platform connector (_shared/platforms) and records the result:
//   posted  → status posted, external_post_urn/url; then the first comment
//   pending → still processing on the platform; resumed on the next run
//   failed  → status failed, publish_error, team alerted (in-app + email)
// Recurring posts get their next occurrence created when a post leaves the
// schedule (spawnNextOccurrence), whatever the outcome.

import { getConnector } from './platforms/index.ts'
import { type Account, type Db, type MediaItem, PublishError } from './platforms/types.ts'
import { renderTemplate, sendViaResend } from './resend.ts'
import { staffWithModule } from './access.ts'

const PROCESSING_TIMEOUT_MS = 60 * 60 * 1000

export type PublishResult =
  | { result: 'posted'; url: string }
  | { result: 'pending'; reason: string }
  | { result: 'failed'; error: string }

export function isAutomated(account: Partial<Account> | null | undefined) {
  return !!account && account.mode === 'automated' && account.status === 'active' && !!account.external_page_id
}

export async function publishPost(db: Db, postId: string): Promise<PublishResult> {
  const { data: post, error } = await db
    .from('posts')
    .select('*, connected_accounts(id, platform, account_name, account_type, external_page_id, mode, status, timezone)')
    .eq('id', postId)
    .single()
  if (error || !post) return { result: 'failed', error: 'Post not found' }
  const account = post.connected_accounts as Account | null

  try {
    if (!account) throw new PublishError('The post has no account selected')
    if (!isAutomated(account)) throw new PublishError(`${account.account_name} is not connected for automatic publishing`)
    const connector = getConnector(account.platform)
    const token = await connector.getToken(db, account)

    const state = post.publish_state?.started_at ? post.publish_state : { started_at: new Date().toISOString() }
    const saveState = async () => { await db.from('posts').update({ publish_state: state }).eq('id', postId) }

    const { data: postAssets } = await db
      .from('post_assets')
      .select('position, content_assets(id, file_name, file_path, file_type, file_size)')
      .eq('post_id', postId)
      .order('position')
    const media: MediaItem[] = (postAssets || [])
      .map((pa: { content_assets: any }) => pa.content_assets)
      .filter(Boolean)
      .map((a: any) => ({ asset_id: a.id, kind: a.file_type, file_name: a.file_name, file_path: a.file_path, file_size: a.file_size }))

    const loadBytes = async (m: MediaItem) => {
      const { data: blob, error: dlError } = await db.storage.from('content-library').download(m.file_path)
      if (dlError || !blob) throw new PublishError(`Could not read ${m.file_name} from the Content Library`)
      return new Uint8Array(await blob.arrayBuffer())
    }

    const signedUrl = async (m: MediaItem, seconds = 3 * 3600) => {
      const { data, error: urlError } = await db.storage.from('content-library').createSignedUrl(m.file_path, seconds)
      if (urlError || !data?.signedUrl) throw new PublishError(`Could not prepare ${m.file_name} for upload`)
      return data.signedUrl
    }

    const outcome = await connector.publish({ post, account, token, media, loadBytes, signedUrl, state, saveState })

    if (outcome.kind === 'pending') {
      if (Date.now() - new Date(state.started_at).getTime() > PROCESSING_TIMEOUT_MS) {
        throw new PublishError(`Still processing after an hour (${outcome.reason})`)
      }
      await db.from('posts').update({
        publish_state: state,
        publish_lock_until: new Date(Date.now() + 60 * 1000).toISOString(),
      }).eq('id', postId)
      return { result: 'pending', reason: outcome.reason }
    }

    await db.from('posts').update({
      status: 'posted',
      posted_at: new Date().toISOString(),
      external_post_urn: outcome.externalId,
      external_post_url: outcome.url,
      publish_error: null,
      publish_state: state,
      publish_lock_until: null,
    }).eq('id', postId)

    // First comment: a failure here does not undo the post — it is shown on it.
    if (post.first_comment?.trim() && connector.postFirstComment && connector.capabilities(account).firstComment) {
      try {
        const urn = await connector.postFirstComment(token, account, outcome.externalId, post.first_comment.trim())
        await db.from('posts').update({ first_comment_urn: urn || 'posted', first_comment_error: null }).eq('id', postId)
      } catch (err) {
        await db.from('posts').update({ first_comment_error: (err as Error).message.slice(0, 300) }).eq('id', postId)
      }
    }

    return { result: 'posted', url: outcome.url }
  } catch (err) {
    const message = (err as Error).message || 'Unknown error'
    await db.from('posts').update({ status: 'failed', publish_error: message, publish_lock_until: null }).eq('id', postId)
    await notifyFailure(db, post, account?.account_name || 'the account', message)
      .catch((e) => console.error('[publisher] failure alert failed:', e.message))
    return { result: 'failed', error: message }
  }
}

// Claims posts so two runs never publish the same one. Returns the ids won.
export async function claimPosts(db: Db, ids: string[], fromStatuses: string[]): Promise<string[]> {
  if (!ids.length) return []
  const { data } = await db
    .from('posts')
    .update({ status: 'publishing', publish_lock_until: new Date(Date.now() + 10 * 60 * 1000).toISOString() })
    .in('id', ids)
    .in('status', fromStatuses)
    .select('id')
  return (data || []).map((r: { id: string }) => r.id)
}

export async function countAttempt(db: Db, id: string) {
  const { data } = await db.from('posts').select('publish_attempts').eq('id', id).single()
  await db.from('posts').update({ publish_attempts: (data?.publish_attempts || 0) + 1 }).eq('id', id)
}

// ── Recurrence ─────────────────────────────────────────────────
// posts.recurrence = { freq: 'daily' | 'weekly' | 'monthly', interval: n, until?: 'YYYY-MM-DD', count?: n }

function nextDate(from: Date, rec: { freq: string; interval?: number }) {
  const n = Math.max(1, Number(rec.interval) || 1)
  const d = new Date(from)
  if (rec.freq === 'daily') d.setUTCDate(d.getUTCDate() + n)
  else if (rec.freq === 'monthly') d.setUTCMonth(d.getUTCMonth() + n)
  else d.setUTCDate(d.getUTCDate() + 7 * n)
  return d
}

// Creates the next occurrence of a recurring post (once — safe to call again).
// Siblings composed together share the next group id too.
// deno-lint-ignore no-explicit-any
export async function spawnNextOccurrence(db: Db, post: any) {
  const rec = post.recurrence
  if (!rec?.freq || !post.scheduled_at) return
  const occurrence = (post.occurrence || 1) + 1
  if (rec.count && occurrence > Number(rec.count)) return
  const when = nextDate(new Date(post.scheduled_at), rec)
  if (rec.until && when > new Date(`${rec.until}T23:59:59Z`)) return

  const root = post.recurrence_parent_id || post.id
  const { data: existing } = await db.from('posts')
    .select('id, account_id, post_group_id').eq('recurrence_parent_id', root).eq('occurrence', occurrence)
  if ((existing || []).some((p: { account_id: string }) => p.account_id === post.account_id)) return
  const groupId = existing?.[0]?.post_group_id || crypto.randomUUID()

  const { data: created, error } = await db.from('posts').insert({
    account_id: post.account_id, post_type: post.post_type, caption: post.caption, hashtags: post.hashtags,
    mentions: post.mentions, pillar_id: post.pillar_id, campaign_id: post.campaign_id, utm_url: post.utm_url,
    mode: post.mode, poll_options: post.poll_options, poll_question: post.poll_question, poll_duration: post.poll_duration,
    first_comment: post.first_comment, created_by: post.created_by,
    status: 'scheduled', scheduled_at: when.toISOString(),
    recurrence: rec, recurrence_parent_id: root, occurrence, post_group_id: groupId,
  }).select('id').single()
  if (error || !created) { console.error('[publisher] recurrence:', error?.message); return }

  const { data: assets } = await db.from('post_assets').select('asset_id, position').eq('post_id', post.id)
  if (assets?.length) {
    await db.from('post_assets').insert(assets.map((a: { asset_id: string; position: number }) => ({ post_id: created.id, asset_id: a.asset_id, position: a.position })))
  }
}

// ── Alerts ─────────────────────────────────────────────────────

function captionPreview(caption: string | null) {
  const text = (caption || '').trim()
  return text.length > 140 ? `${text.slice(0, 140)}…` : text
}

// deno-lint-ignore no-explicit-any
async function notifyFailure(db: Db, post: any, accountName: string, error: string) {
  const recipients = await staffWithModule(db, 'social_calendar', ['admin', 'marketing'], 'id, email')
  if (!recipients.length) return
  await db.from('in_app_notifications').insert(recipients.map((r: { id: string }) => ({
    user_id: r.id,
    type: 'post_failed',
    title: `Post failed to publish on ${accountName}`,
    body: `${error} — ${captionPreview(post.caption)}`.slice(0, 300),
    link: '/social/calendar',
  })))

  const { data: template } = await db.from('email_templates').select('*').eq('template_key', 'sm_post_failed').maybeSingle()
  if (!template?.is_active || !Deno.env.get('RESEND_API_KEY')) return
  const { data: baseUrlRow } = await db.from('system_settings').select('value').eq('key', 'app_base_url').maybeSingle()
  const vars = {
    scheduled_for: post.scheduled_at ? new Date(post.scheduled_at).toUTCString() : 'now',
    account_name: accountName,
    error,
    post_caption_preview: captionPreview(post.caption),
    calendar_link: `${(baseUrlRow?.value || '').replace(/\/$/, '')}/social/calendar`,
  }
  await Promise.allSettled(
    recipients.filter((r: { email?: string }) => r.email).map((r: { email: string }) =>
      sendViaResend([r.email], renderTemplate(template.subject, vars), renderTemplate(template.body_html, vars))
    )
  )
}
