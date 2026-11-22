// Instagram professional account connector (Instagram API with Facebook
// Login; calls use the linked Page's token). Every post needs media:
// one image, a carousel (2–10 images) or a video (published as a Reel).
// Images must be JPEG. Media is fetched by Meta from short-lived signed
// links. Publishing is two steps — create a container, then publish it — and
// videos are processed first, so a post can be "pending" for a few minutes.

import { graph, graphAll, getStoredMetaToken, friendlyMetaError, insightDay } from '../meta.ts'
import {
  type Capabilities, type Connector, type PublishInput, type PublishOutcome,
  type RemoteComment, type RemotePost, type Stats, PublishError, zeroStats,
} from './types.ts'

const MAX_CAPTION = 2200

function caption(text: string | null, hashtags: string[] | null) {
  const tags = (hashtags || []).map((h) => `#${h.replace(/^#/, '')}`).join(' ')
  return [text?.trim(), tags].filter(Boolean).join('\n\n')
}

async function containerStatus(id: string, token: string) {
  const r = await graph(id, token, { fields: 'status_code,status' })
  return { code: String(r.status_code || ''), detail: String(r.status || '') }
}

async function permalink(id: string, token: string) {
  try { return (await graph(id, token, { fields: 'permalink' })).permalink as string } catch { return 'https://www.instagram.com/' }
}

export const instagramConnector: Connector = {
  platform: 'instagram',

  capabilities(): Capabilities {
    return { publish: true, firstComment: true, postStats: true, followers: true, comments: true, reply: true }
  },

  getToken: (db, account) => getStoredMetaToken(db, account.id),

  postUrl: () => 'https://www.instagram.com/',

  async publish({ post, account, token, media, signedUrl, state, saveState }: PublishInput): Promise<PublishOutcome> {
    const ig = account.external_page_id
    const text = caption(post.caption, post.hashtags)
    if (text.length > MAX_CAPTION) throw new PublishError(`Caption is longer than Instagram's ${MAX_CAPTION} characters`)
    if ((post.hashtags || []).length > 30) throw new PublishError('Instagram allows at most 30 hashtags')

    try {
      // 1. Create the container once (remembered across runs).
      if (!state.container) {
        if (post.post_type === 'image') {
          const images = media.filter((m) => m.kind === 'image').slice(0, 10)
          if (!images.length) throw new PublishError('Instagram posts need an image or video')
          const bad = images.find((m) => !/\.jpe?g$/i.test(m.file_name))
          if (bad) throw new PublishError(`${bad.file_name}: Instagram only accepts JPEG images`)
          if (images.length === 1) {
            state.container = (await graph(`${ig}/media`, token, { image_url: await signedUrl(images[0]), caption: text }, 'POST')).id
          } else {
            const children: string[] = []
            for (const m of images) {
              children.push((await graph(`${ig}/media`, token, { image_url: await signedUrl(m), is_carousel_item: true }, 'POST')).id)
            }
            state.container = (await graph(`${ig}/media`, token, { media_type: 'CAROUSEL', children: children.join(','), caption: text }, 'POST')).id
          }
        } else if (post.post_type === 'video') {
          const video = media.find((m) => m.kind === 'video')
          if (!video) throw new PublishError('Video post has no video attached')
          state.container = (await graph(`${ig}/media`, token, { media_type: 'REELS', video_url: await signedUrl(video, 6 * 3600), caption: text }, 'POST')).id
        } else {
          throw new PublishError(`Instagram doesn't support ${post.post_type} posts — use an image or a video`)
        }
        await saveState()
      }

      // 2. Wait until Instagram has processed the media.
      const status = await containerStatus(state.container, token)
      if (status.code === 'ERROR' || status.code === 'EXPIRED') {
        delete state.container
        await saveState()
        throw new PublishError(`Instagram could not process the media${status.detail ? ` (${status.detail})` : ''}`)
      }
      if (status.code && status.code !== 'FINISHED' && status.code !== 'PUBLISHED') {
        return { kind: 'pending', reason: 'Instagram is processing the media' }
      }

      // 3. Publish.
      const res = await graph(`${ig}/media_publish`, token, { creation_id: state.container }, 'POST')
      return { kind: 'posted', externalId: res.id, url: await permalink(res.id, token) }
    } catch (err) {
      if (err instanceof PublishError) throw err
      throw new PublishError(friendlyMetaError(err))
    }
  },

  async postFirstComment(token, _account, mediaId, message) {
    return (await graph(`${mediaId}/comments`, token, { message }, 'POST')).id
  },

  async replyToComment(token, _account, mediaId, parentCommentId, message) {
    if (!parentCommentId) return (await graph(`${mediaId}/comments`, token, { message }, 'POST')).id
    return (await graph(`${parentCommentId}/replies`, token, { message }, 'POST')).id
  },

  async listComments(token, account, mediaId): Promise<RemoteComment[]> {
    const items = await graphAll(`${mediaId}/comments`, token, {
      fields: 'id,text,username,timestamp,replies{id,text,username,timestamp}', limit: 100,
    }, 500)
    const out: RemoteComment[] = []
    const self = account.account_name.replace(/^@/, '').toLowerCase()
    for (const c of items) {
      out.push({ externalId: c.id, parentExternalId: null, authorName: c.username ? `@${c.username}` : 'Instagram user', authorIsSelf: String(c.username || '').toLowerCase() === self, text: c.text || '', createdAt: new Date(c.timestamp).toISOString() })
      for (const r of c.replies?.data || []) {
        out.push({ externalId: r.id, parentExternalId: c.id, authorName: r.username ? `@${r.username}` : 'Instagram user', authorIsSelf: String(r.username || '').toLowerCase() === self, text: r.text || '', createdAt: new Date(r.timestamp).toISOString() })
      }
    }
    return out
  },

  async postStats(token, _account, ids) {
    const out = new Map<string, Stats>()
    for (const id of ids) {
      const s = zeroStats()
      try {
        const m = await graph(id, token, { fields: 'like_count,comments_count' })
        s.reactions = m.like_count || 0
        s.comments = m.comments_count || 0
      } catch { /* deleted or not accessible */ }
      for (const set of ['reach,views,shares,saved', 'reach,shares,saved', 'reach']) {
        try {
          const r = await graph(`${id}/insights`, token, { metric: set })
          for (const row of r.data || []) {
            const v = Number(row.values?.[0]?.value ?? row.total_value?.value) || 0
            if (row.name === 'reach') s.reach = v
            if (row.name === 'views') s.impressions = v
            if (row.name === 'shares') s.shares = v
          }
          if (!s.impressions) s.impressions = s.reach
          break
        } catch { /* try a smaller metric set */ }
      }
      out.set(id, s)
    }
    return out
  },

  async followerCount(token, account) {
    const r = await graph(account.external_page_id, token, { fields: 'followers_count' })
    return typeof r.followers_count === 'number' ? r.followers_count : null
  },

  // Daily account reach (Instagram keeps daily account insights for a limited
  // window; older days simply come back empty). 30-day requests.
  async dailyAccountStats(token, account, from, to) {
    const out = new Map<string, Stats>()
    for (let s = Math.max(from.getTime(), to.getTime() - 730 * 86400000); s < to.getTime(); s += 30 * 86400000) {
      const e = Math.min(s + 30 * 86400000, to.getTime())
      try {
        const r = await graph(`${account.external_page_id}/insights`, token, { metric: 'reach', period: 'day', since: Math.floor(s / 1000), until: Math.floor(e / 1000) })
        for (const v of r.data?.[0]?.values || []) {
          if (!v.end_time) continue
          const day = insightDay(v.end_time)
          const cur = out.get(day) || zeroStats()
          cur.reach = Number(v.value) || 0
          cur.impressions = cur.reach
          out.set(day, cur)
        }
      } catch (err) {
        console.warn('[instagram] daily reach', (err as Error).message)
      }
    }
    return out
  },

  // New followers per day (Instagram only offers the last 30 days).
  async dailyFollowerGains(token, account, from, to) {
    const out = new Map<string, number>()
    const start = Math.max(from.getTime(), to.getTime() - 29 * 86400000)
    try {
      const r = await graph(`${account.external_page_id}/insights`, token, { metric: 'follower_count', period: 'day', since: Math.floor(start / 1000), until: Math.floor(to.getTime() / 1000) })
      for (const v of r.data?.[0]?.values || []) if (v.end_time) out.set(insightDay(v.end_time), Number(v.value) || 0)
    } catch (err) {
      console.warn('[instagram] follower gains', (err as Error).message)
    }
    return out
  },

  async listPosts(token, account, since): Promise<RemotePost[]> {
    const items = await graphAll(`${account.external_page_id}/media`, token, { fields: 'id,caption,media_type,timestamp,permalink', limit: 100 }, 1000)
    return items
      .filter((m: any) => new Date(m.timestamp) >= since)
      .map((m: any) => ({
        externalId: m.id,
        url: m.permalink,
        caption: m.caption || '',
        postType: m.media_type === 'VIDEO' ? 'video' : 'image',
        publishedAt: new Date(m.timestamp).toISOString(),
      }))
  },
}
