// LinkedIn connector (Community Management API). Company Pages
// (account_type 'organization', urn:li:organization:X) and personal
// profiles ('member', urn:li:person:X). Low-level API client: ../linkedin.ts.

import { getValidLinkedInAccessToken, liFetch, postUrlFor } from '../linkedin.ts'
import {
  type Account, type Capabilities, type Connector, type PublishInput, type PublishOutcome,
  type RemoteComment, type Stats, PublishError, zeroStats,
} from './types.ts'

const MAX_COMMENTARY = 3000
const MAX_VIDEO_BYTES = 200 * 1024 * 1024 // Edge Function memory, not LinkedIn's limit

// Little Text Format: escape markup characters so they show literally; '#'
// starting a word stays a hashtag.
export function escapeLittleText(text: string) {
  return text
    .replace(/[\\|{}@\[\]()<>*_~]/g, (c) => `\\${c}`)
    .replace(/#(?![\p{L}\p{N}])/gu, '\\#')
}

export function buildCommentary(caption: string | null, hashtags: string[] | null) {
  const tags = (hashtags || []).map((h) => `#${h.replace(/^#/, '')}`).join(' ')
  return escapeLittleText([caption?.trim(), tags].filter(Boolean).join('\n\n'))
}

// ── Media ───────────────────────────────────────────────────────

async function putBytes(url: string, token: string, bytes: Uint8Array) {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
    body: bytes,
  })
  if (!res.ok) throw new PublishError(`Upload to LinkedIn failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
  return res
}

async function uploadImage(token: string, owner: string, bytes: Uint8Array) {
  const { data } = await liFetch(token, '/images?action=initializeUpload', { method: 'POST', body: { initializeUploadRequest: { owner } } })
  await putBytes(data.value.uploadUrl, token, bytes)
  return data.value.image as string
}

async function uploadDocument(token: string, owner: string, bytes: Uint8Array) {
  const { data } = await liFetch(token, '/documents?action=initializeUpload', { method: 'POST', body: { initializeUploadRequest: { owner } } })
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

interface Uploaded { asset_id: string; urn: string; title: string; kind: 'image' | 'video' | 'document' }

// deno-lint-ignore no-explicit-any
function buildContent(post: any, media: Uploaded[]) {
  switch (post.post_type) {
    case 'text': return undefined
    case 'image':
      if (!media.length) throw new PublishError('Image post has no image attached')
      return media.length === 1
        ? { media: { id: media[0].urn } }
        : { multiImage: { images: media.slice(0, 20).map((m) => ({ id: m.urn })) } }
    case 'video':
    case 'carousel':
      if (!media.length) throw new PublishError(post.post_type === 'video' ? 'Video post has no video attached' : 'Document post has no document attached')
      return { media: { id: media[0].urn, title: media[0].title } }
    case 'poll': {
      const question = (post.poll_question || '').trim()
      const options = (post.poll_options || []).map((o: { text?: string } | string) => (typeof o === 'string' ? o : o.text || '').trim()).filter(Boolean)
      if (!question) throw new PublishError('Poll has no question')
      if (question.length > 140) throw new PublishError('Poll question is longer than 140 characters')
      if (options.length < 2 || options.length > 4) throw new PublishError('A poll needs 2 to 4 options')
      if (options.some((o: string) => o.length > 30)) throw new PublishError('Poll options must be 30 characters or fewer')
      return { poll: { question, options: options.map((text: string) => ({ text })), settings: { duration: post.poll_duration || 'THREE_DAYS' } } }
    }
    default: throw new PublishError(`LinkedIn does not support ${post.post_type} posts`)
  }
}

const EXPECTED_KIND: Record<string, Uploaded['kind'] | undefined> = { image: 'image', video: 'video', carousel: 'document' }

// ── Connector ───────────────────────────────────────────────────

export const linkedinConnector: Connector = {
  platform: 'linkedin',

  capabilities(account: Account): Capabilities {
    const isPage = account.account_type === 'organization'
    return { publish: true, firstComment: true, postStats: true, followers: isPage, comments: isPage, reply: isPage }
  },

  getToken: (db, account) => getValidLinkedInAccessToken(db, account.id),

  postUrl: (id) => postUrlFor(id),

  async publish({ post, account, token, media, loadBytes, state, saveState }: PublishInput): Promise<PublishOutcome> {
    const author = account.external_page_id
    const commentary = buildCommentary(post.caption, post.hashtags)
    if (commentary.length > MAX_COMMENTARY) throw new PublishError(`Caption is longer than LinkedIn's ${MAX_COMMENTARY} characters`)
    if (!commentary.trim() && post.post_type === 'text') throw new PublishError('The post has no text')

    state.media = state.media || []
    const uploaded: Uploaded[] = state.media
    const kind = EXPECTED_KIND[post.post_type]
    if (kind) {
      const wanted = kind === 'image' ? media.slice(0, 20) : media.slice(0, 1)
      for (const m of wanted) {
        if (uploaded.some((u) => u.asset_id === m.asset_id)) continue
        if (m.kind !== kind) throw new PublishError(`${m.file_name} is not ${kind === 'image' ? 'an image' : kind === 'video' ? 'a video' : 'a document (PDF, PPTX or DOCX)'}`)
        if (kind === 'video' && m.file_size && m.file_size > MAX_VIDEO_BYTES) throw new PublishError('Video is larger than 200 MB — post it manually instead')
        const bytes = await loadBytes(m)
        const urn = kind === 'image' ? await uploadImage(token, author, bytes)
          : kind === 'video' ? await uploadVideo(token, author, bytes)
          : await uploadDocument(token, author, bytes)
        uploaded.push({ asset_id: m.asset_id, urn, title: m.file_name, kind })
        await saveState()
      }
    }

    // Videos and documents must finish processing on LinkedIn first.
    for (const u of uploaded) {
      if (u.kind === 'image') continue
      const { data } = await liFetch(token, `/${u.kind === 'video' ? 'videos' : 'documents'}/${encodeURIComponent(u.urn)}`)
      const status = data?.status || 'UNKNOWN'
      if (status === 'PROCESSING_FAILED') throw new PublishError(`LinkedIn could not process ${u.title}`)
      if (status !== 'AVAILABLE') return { kind: 'pending', reason: `${u.title} is ${status.toLowerCase()}` }
    }

    const content = buildContent(post, uploaded)
    const { headers } = await liFetch(token, '/posts', {
      method: 'POST',
      body: {
        author, commentary, visibility: 'PUBLIC',
        distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false,
        ...(content ? { content } : {}),
      },
    })
    const urn = headers.get('x-restli-id') || headers.get('x-linkedin-id') || ''
    if (!urn) throw new PublishError('LinkedIn accepted the post but did not return its id')
    return { kind: 'posted', externalId: urn, url: postUrlFor(urn) }
  },

  async postFirstComment(token, account, postUrn, text) {
    return await createComment(token, account, postUrn, null, text)
  },

  async replyToComment(token, account, postUrn, parentCommentId, text) {
    return await createComment(token, account, postUrn, parentCommentId, text)
  },

  async postStats(token, account, urns) {
    return account.account_type === 'organization'
      ? await orgPostStats(token, account.external_page_id, urns)
      : await memberStats(token, urns)
  },

  async followerCount(token, account) {
    if (account.account_type !== 'organization') return null
    const { data } = await liFetch(token, `/networkSizes/${encodeURIComponent(account.external_page_id)}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`)
    return typeof data?.firstDegreeSize === 'number' ? data.firstDegreeSize : null
  },

  async listComments(token, account, postUrn): Promise<RemoteComment[]> {
    const { data } = await liFetch(token, `/socialActions/${encodeURIComponent(postUrn)}/comments`)
    // deno-lint-ignore no-explicit-any
    return (data?.elements || []).map((c: any) => ({
      externalId: c.commentUrn || `${postUrn}:comment:${c.id}`,
      parentExternalId: c.parentComment || null,
      authorName: c.actor === account.external_page_id ? account.account_name
        : String(c.actor || '').startsWith('urn:li:organization:') ? 'A LinkedIn page' : 'LinkedIn member',
      authorIsSelf: c.actor === account.external_page_id,
      text: c.message?.text || '',
      createdAt: c.created?.time ? new Date(c.created.time).toISOString() : new Date().toISOString(),
    }))
  },
}

// Comments are written as the account itself (page or person). Plain text:
// escape markup so the comment shows exactly as typed.
async function createComment(token: string, account: Account, postUrn: string, parentCommentId: string | null, text: string) {
  const { data, headers } = await liFetch(token, `/socialActions/${encodeURIComponent(postUrn)}/comments`, {
    method: 'POST',
    body: {
      actor: account.external_page_id,
      object: postUrn,
      message: { text: escapeLittleText(text) },
      ...(parentCommentId ? { parentComment: parentCommentId } : {}),
    },
  })
  return data?.commentUrn || headers.get('x-restli-id') || ''
}

async function orgPostStats(token: string, orgUrn: string, urns: string[]): Promise<Map<string, Stats>> {
  const out = new Map<string, Stats>()
  const base = `/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${encodeURIComponent(orgUrn)}`
  const groups: [string, string[]][] = [
    ['shares', urns.filter((u) => u.startsWith('urn:li:share:'))],
    ['ugcPosts', urns.filter((u) => u.startsWith('urn:li:ugcPost:'))],
  ]
  for (const [param, list] of groups) {
    for (let i = 0; i < list.length; i += 20) {
      const { data } = await liFetch(token, `${base}&${param}=List(${list.slice(i, i + 20).map(encodeURIComponent).join(',')})`)
      for (const el of data?.elements || []) {
        const urn = el.share || el.ugcPost
        const s = el.totalShareStatistics || {}
        if (urn) out.set(urn, { impressions: s.impressionCount || 0, reach: s.uniqueImpressionsCount || 0, reactions: s.likeCount || 0, comments: s.commentCount || 0, shares: s.shareCount || 0, clicks: s.clickCount || 0 })
      }
    }
  }
  for (const u of urns) if (!out.has(u)) out.set(u, zeroStats())
  return out
}

const MEMBER_QUERIES: [keyof Stats, string][] = [
  ['impressions', 'IMPRESSION'], ['reach', 'MEMBERS_REACHED'], ['reactions', 'REACTION'],
  ['comments', 'COMMENT'], ['shares', 'RESHARE'], ['clicks', 'LINK_CLICKS'],
]

async function memberStats(token: string, urns: string[]): Promise<Map<string, Stats>> {
  const out = new Map<string, Stats>()
  for (const urn of urns) {
    const entity = urn.startsWith('urn:li:ugcPost:') ? `(ugc:${encodeURIComponent(urn)})` : `(share:${encodeURIComponent(urn)})`
    const stats = zeroStats()
    for (const [key, queryType] of MEMBER_QUERIES) {
      try {
        const { data } = await liFetch(token, `/memberCreatorPostAnalytics?q=entity&entity=${entity}&queryType=${queryType}&aggregation=TOTAL`)
        stats[key] = (data?.elements || []).reduce((sum: number, el: { count?: number }) => sum + (el.count || 0), 0)
      } catch (err) {
        console.warn(`[linkedin] ${queryType} for ${urn}:`, (err as Error).message)
      }
    }
    out.set(urn, stats)
  }
  return out
}
