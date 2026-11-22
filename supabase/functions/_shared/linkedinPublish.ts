// Publishes a BMS post to LinkedIn (Automated Mode), for both the Company
// Page (author urn:li:organization:X) and a person's own profile (author
// urn:li:person:X). Shared by sm-move-to-ready (scheduled, via cron) and
// sm-publish (Retry / Publish now from the Content Calendar).
//
// Lifecycle: the caller claims a post (status 'publishing' + a lock), then
// calls publishPost(). Media is uploaded once and remembered in
// posts.publish_state, so a run that stops halfway (or a video LinkedIn is
// still processing) resumes on the next cron run instead of re-uploading.
//   result 'posted'  → status posted, external_post_urn/url set
//   result 'pending' → still processing on LinkedIn's side; lock released
//                      for a short while and the next run picks it up
//   result 'failed'  → status failed, publish_error set, team alerted

import { liFetch, getValidLinkedInAccessToken, postUrlFor } from './linkedin.ts'
import { renderTemplate, sendViaResend } from './resend.ts'
import { staffWithModule } from './access.ts'

const MAX_COMMENTARY = 3000
const MAX_VIDEO_BYTES = 200 * 1024 * 1024 // Edge Function memory, not LinkedIn's limit
const PROCESSING_TIMEOUT_MS = 60 * 60 * 1000
const VIDEO_PART = 4 * 1024 * 1024

// deno-lint-ignore no-explicit-any
type Db = any

interface MediaState { asset_id: string; urn: string; title: string; kind: 'image' | 'video' | 'document' }
interface PublishState { started_at: string; media: MediaState[] }

export type PublishResult =
  | { result: 'posted'; urn: string; url: string }
  | { result: 'pending'; reason: string }
  | { result: 'failed'; error: string }

class PublishError extends Error {}

// Little Text Format: these characters are markup and must be escaped to be
// shown literally. '#' is left alone when it starts a hashtag (#word), so
// hashtags typed in the caption and the hashtag list stay clickable.
export function escapeLittleText(text: string) {
  return text
    .replace(/[\\|{}@\[\]()<>*_~]/g, (c) => `\\${c}`)
    .replace(/#(?![\p{L}\p{N}])/gu, '\\#')
}

export function buildCommentary(caption: string | null, hashtags: string[] | null) {
  const tags = (hashtags || []).map((h) => `#${h.replace(/^#/, '')}`).join(' ')
  const raw = [caption?.trim(), tags].filter(Boolean).join('\n\n')
  return escapeLittleText(raw)
}

// ── Media upload ────────────────────────────────────────────────

async function putBytes(url: string, token: string, bytes: Uint8Array, extraHeaders: Record<string, string> = {}) {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream', ...extraHeaders },
    body: bytes,
  })
  if (!res.ok) {
    throw new PublishError(`Upload to LinkedIn failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
  }
  return res
}

async function uploadImage(token: string, owner: string, bytes: Uint8Array) {
  const { data } = await liFetch(token, '/images?action=initializeUpload', {
    method: 'POST', body: { initializeUploadRequest: { owner } },
  })
  await putBytes(data.value.uploadUrl, token, bytes)
  return data.value.image as string
}

async function uploadDocument(token: string, owner: string, bytes: Uint8Array) {
  const { data } = await liFetch(token, '/documents?action=initializeUpload', {
    method: 'POST', body: { initializeUploadRequest: { owner } },
  })
  await putBytes(data.value.uploadUrl, token, bytes)
  return data.value.document as string
}

async function uploadVideo(token: string, owner: string, bytes: Uint8Array) {
  const { data } = await liFetch(token, '/videos?action=initializeUpload', {
    method: 'POST',
    body: { initializeUploadRequest: { owner, fileSizeBytes: bytes.byteLength, uploadCaptions: false, uploadThumbnail: false } },
  })
  const value = data.value
  const partIds: string[] = []
  for (const part of value.uploadInstructions as { uploadUrl: string; firstByte: number; lastByte: number }[]) {
    const res = await putBytes(part.uploadUrl, token, bytes.subarray(part.firstByte, part.lastByte + 1))
    const etag = res.headers.get('etag')
    if (!etag) throw new PublishError('LinkedIn did not return an ETag for a video part')
    partIds.push(etag.replace(/"/g, ''))
  }
  await liFetch(token, '/videos?action=finalizeUpload', {
    method: 'POST',
    body: { finalizeUploadRequest: { video: value.video, uploadToken: value.uploadToken || '', uploadedPartIds: partIds } },
  })
  return value.video as string
}

async function mediaStatus(token: string, m: MediaState): Promise<string> {
  const path = m.kind === 'video' ? 'videos' : m.kind === 'document' ? 'documents' : 'images'
  const { data } = await liFetch(token, `/${path}/${encodeURIComponent(m.urn)}`)
  return data?.status || 'UNKNOWN'
}

// ── Post body ───────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
function buildContent(post: any, media: MediaState[]) {
  switch (post.post_type) {
    case 'text':
      return undefined
    case 'image':
      if (media.length === 0) throw new PublishError('Image post has no image attached')
      if (media.length === 1) return { media: { id: media[0].urn } }
      return { multiImage: { images: media.slice(0, 20).map((m) => ({ id: m.urn })) } }
    case 'video':
      if (media.length === 0) throw new PublishError('Video post has no video attached')
      return { media: { id: media[0].urn, title: media[0].title } }
    case 'carousel':
      if (media.length === 0) throw new PublishError('Document post has no document attached')
      return { media: { id: media[0].urn, title: media[0].title } }
    case 'poll': {
      const question = (post.poll_question || '').trim()
      const options = (post.poll_options || []).map((o: { text?: string } | string) => (typeof o === 'string' ? o : o.text || '').trim()).filter(Boolean)
      if (!question) throw new PublishError('Poll has no question')
      if (question.length > 140) throw new PublishError('Poll question is longer than 140 characters')
      if (options.length < 2 || options.length > 4) throw new PublishError('A poll needs 2 to 4 options')
      if (options.some((o: string) => o.length > 30)) throw new PublishError('Poll options must be 30 characters or fewer')
      return {
        poll: {
          question,
          options: options.map((text: string) => ({ text })),
          settings: { duration: post.poll_duration || 'THREE_DAYS' },
        },
      }
    }
    default:
      throw new PublishError(`Unsupported post type: ${post.post_type}`)
  }
}

const EXPECTED_KIND: Record<string, MediaState['kind'] | undefined> = { image: 'image', video: 'video', carousel: 'document' }

// ── Main entry ──────────────────────────────────────────────────

export async function publishPost(db: Db, postId: string): Promise<PublishResult> {
  const { data: post, error } = await db
    .from('posts')
    .select('*, connected_accounts(id, account_name, account_type, external_page_id, mode, status)')
    .eq('id', postId)
    .single()
  if (error || !post) return { result: 'failed', error: 'Post not found' }

  const account = post.connected_accounts
  try {
    if (!account) throw new PublishError('The post has no LinkedIn account selected')
    if (account.status !== 'active' || account.mode !== 'automated' || !account.external_page_id) {
      throw new PublishError(`${account.account_name} is not connected for automatic publishing`)
    }
    const author = account.external_page_id as string

    const commentary = buildCommentary(post.caption, post.hashtags)
    if (commentary.length > MAX_COMMENTARY) throw new PublishError(`Caption is longer than LinkedIn's ${MAX_COMMENTARY} characters`)
    if (!commentary.trim() && post.post_type === 'text') throw new PublishError('The post has no text')

    const token = await getValidLinkedInAccessToken(db, account.id)
    const state: PublishState = post.publish_state?.started_at
      ? post.publish_state
      : { started_at: new Date().toISOString(), media: [] }

    // 1. Upload any media not uploaded yet (saved after each one).
    const kind = EXPECTED_KIND[post.post_type]
    if (kind) {
      const { data: postAssets } = await db
        .from('post_assets')
        .select('position, content_assets(id, file_name, file_path, file_type, file_size)')
        .eq('post_id', postId)
        .order('position')
      const assets = (postAssets || []).map((pa: { content_assets: any }) => pa.content_assets).filter(Boolean)
      const wanted = kind === 'image' ? assets.slice(0, 20) : assets.slice(0, 1)
      for (const asset of wanted) {
        if (state.media.some((m) => m.asset_id === asset.id)) continue
        if (kind === 'image' && asset.file_type !== 'image') throw new PublishError(`${asset.file_name} is not an image`)
        if (kind === 'video' && asset.file_type !== 'video') throw new PublishError(`${asset.file_name} is not a video`)
        if (kind === 'document' && asset.file_type !== 'document') throw new PublishError(`${asset.file_name} is not a document (PDF, PPTX or DOCX)`)
        if (kind === 'video' && asset.file_size && asset.file_size > MAX_VIDEO_BYTES) {
          throw new PublishError('Video is larger than 200 MB — post it manually instead')
        }
        const { data: blob, error: dlError } = await db.storage.from('content-library').download(asset.file_path)
        if (dlError || !blob) throw new PublishError(`Could not read ${asset.file_name} from the Content Library`)
        const bytes = new Uint8Array(await blob.arrayBuffer())
        const urn = kind === 'image'
          ? await uploadImage(token, author, bytes)
          : kind === 'video'
            ? await uploadVideo(token, author, bytes)
            : await uploadDocument(token, author, bytes)
        state.media.push({ asset_id: asset.id, urn, title: asset.file_name, kind })
        await db.from('posts').update({ publish_state: state }).eq('id', postId)
      }
    }

    // 2. Videos and documents must finish processing before they can be posted.
    for (const m of state.media) {
      if (m.kind === 'image') continue
      const status = await mediaStatus(token, m)
      if (status === 'PROCESSING_FAILED') throw new PublishError(`LinkedIn could not process ${m.title}`)
      if (status !== 'AVAILABLE') {
        if (Date.now() - new Date(state.started_at).getTime() > PROCESSING_TIMEOUT_MS) {
          throw new PublishError(`LinkedIn was still processing ${m.title} after an hour`)
        }
        await db.from('posts').update({
          publish_state: state,
          publish_lock_until: new Date(Date.now() + 60 * 1000).toISOString(),
        }).eq('id', postId)
        return { result: 'pending', reason: `${m.title} is ${status.toLowerCase()}` }
      }
    }

    // 3. Create the post.
    const content = buildContent(post, state.media)
    const { headers } = await liFetch(token, '/posts', {
      method: 'POST',
      body: {
        author,
        commentary,
        visibility: 'PUBLIC',
        distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
        ...(content ? { content } : {}),
      },
    })
    const urn = headers.get('x-restli-id') || headers.get('x-linkedin-id') || ''
    if (!urn) throw new PublishError('LinkedIn accepted the post but did not return its id')
    const url = postUrlFor(urn)

    await db.from('posts').update({
      status: 'posted',
      posted_at: new Date().toISOString(),
      external_post_urn: urn,
      external_post_url: url,
      publish_error: null,
      publish_state: state,
      publish_lock_until: null,
    }).eq('id', postId)

    return { result: 'posted', urn, url }
  } catch (err) {
    const message = (err as Error).message || 'Unknown error'
    await db.from('posts').update({
      status: 'failed',
      publish_error: message,
      publish_lock_until: null,
    }).eq('id', postId)
    await notifyFailure(db, post, account?.account_name || 'LinkedIn', message).catch((e) =>
      console.error('[linkedinPublish] failure alert failed:', e.message)
    )
    return { result: 'failed', error: message }
  }
}

// Claims posts for publishing so two runs never publish the same post.
// Returns the ids this caller now owns.
export async function claimPosts(db: Db, ids: string[], fromStatuses: string[]): Promise<string[]> {
  if (ids.length === 0) return []
  const { data } = await db
    .from('posts')
    .update({ status: 'publishing', publish_lock_until: new Date(Date.now() + 10 * 60 * 1000).toISOString() })
    .in('id', ids)
    .in('status', fromStatuses)
    .select('id')
  return (data || []).map((r: { id: string }) => r.id)
}

// Bumps the attempt counter (separate from claim so a pending video resume
// is not counted as a new attempt by the claim itself).
export async function countAttempt(db: Db, id: string) {
  const { data } = await db.from('posts').select('publish_attempts').eq('id', id).single()
  await db.from('posts').update({ publish_attempts: (data?.publish_attempts || 0) + 1 }).eq('id', id)
}

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
