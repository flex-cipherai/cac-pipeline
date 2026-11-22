// Facebook Page connector (Graph API with a Page access token).
// Text, photo(s) and video posts; first comment; comments + replies; post
// and Page insights; past posts. Meta fetches media from a URL, so media goes
// up as short-lived signed Content Library links.

import { graph, graphAll, getStoredMetaToken, friendlyMetaError, insightDay } from '../meta.ts'
import {
  type Account, type Capabilities, type Connector, type PublishInput, type PublishOutcome,
  type RemoteComment, type RemotePost, type Stats, PublishError, zeroStats,
} from './types.ts'

const MAX_CAPTION = 63206

function text(caption: string | null, hashtags: string[] | null) {
  const tags = (hashtags || []).map((h) => `#${h.replace(/^#/, '')}`).join(' ')
  return [caption?.trim(), tags].filter(Boolean).join('\n\n')
}

// One insight metric for an object; Meta retires metric names over time, so
// each is tried on its own and a missing one counts as 0.
async function metric(id: string, token: string, names: string[], params: Record<string, string> = {}) {
  for (const name of names) {
    try {
      const res = await graph(`${id}/insights`, token, { metric: name, ...params })
      const values = res.data?.[0]?.values || []
      return { name, values }
    } catch { /* try the next name */ }
  }
  return { name: '', values: [] as { value: unknown; end_time?: string }[] }
}

const lifetime = (values: { value: unknown }[]) => Number(values?.[0]?.value) || 0

export const facebookConnector: Connector = {
  platform: 'facebook',

  capabilities(): Capabilities {
    return { publish: true, firstComment: true, postStats: true, followers: true, comments: true, reply: true }
  },

  getToken: (db, account) => getStoredMetaToken(db, account.id),

  postUrl: (id) => `https://www.facebook.com/${id}`,

  async publish({ post, account, token, media, signedUrl }: PublishInput): Promise<PublishOutcome> {
    const page = account.external_page_id
    const message = text(post.caption, post.hashtags)
    if (message.length > MAX_CAPTION) throw new PublishError('Caption is longer than Facebook allows')
    try {
      if (post.post_type === 'text') {
        if (!message) throw new PublishError('The post has no text')
        const res = await graph(`${page}/feed`, token, { message, ...(post.utm_url ? { link: post.utm_url } : {}) }, 'POST')
        return { kind: 'posted', externalId: res.id, url: `https://www.facebook.com/${res.id}` }
      }
      if (post.post_type === 'image') {
        const images = media.filter((m) => m.kind === 'image').slice(0, 10)
        if (!images.length) throw new PublishError('Image post has no image attached')
        if (images.length === 1) {
          const res = await graph(`${page}/photos`, token, { url: await signedUrl(images[0]), caption: message, published: true }, 'POST')
          const id = res.post_id || res.id
          return { kind: 'posted', externalId: id, url: `https://www.facebook.com/${id}` }
        }
        const ids: string[] = []
        for (const m of images) {
          const res = await graph(`${page}/photos`, token, { url: await signedUrl(m), published: false }, 'POST')
          ids.push(res.id)
        }
        const params: Record<string, string> = { message }
        ids.forEach((id, i) => { params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id }) })
        const res = await graph(`${page}/feed`, token, params, 'POST')
        return { kind: 'posted', externalId: res.id, url: `https://www.facebook.com/${res.id}` }
      }
      if (post.post_type === 'video') {
        const video = media.find((m) => m.kind === 'video')
        if (!video) throw new PublishError('Video post has no video attached')
        const res = await graph(`${page}/videos`, token, { file_url: await signedUrl(video), description: message }, 'POST')
        return { kind: 'posted', externalId: res.id, url: `https://www.facebook.com/${res.id}` }
      }
      throw new PublishError(`Facebook Pages don't support ${post.post_type} posts from the BMS`)
    } catch (err) {
      if (err instanceof PublishError) throw err
      throw new PublishError(friendlyMetaError(err))
    }
  },

  async postFirstComment(token, _account, postId, message) {
    const res = await graph(`${postId}/comments`, token, { message }, 'POST')
    return res.id
  },

  // Facebook threads replies under the comment being answered.
  async replyToComment(token, _account, postId, parentCommentId, message) {
    const res = await graph(`${parentCommentId || postId}/comments`, token, { message }, 'POST')
    return res.id
  },

  async listComments(token, account, postId): Promise<RemoteComment[]> {
    const items = await graphAll(`${postId}/comments`, token, { fields: 'id,message,from{id,name},created_time,parent{id}', filter: 'stream', limit: 100 }, 500)
    return items.map((c: any) => ({
      externalId: c.id,
      parentExternalId: c.parent?.id || null,
      authorName: c.from?.name || 'Facebook user',
      authorIsSelf: c.from?.id === account.external_page_id,
      text: c.message || '',
      createdAt: c.created_time ? new Date(c.created_time).toISOString() : new Date().toISOString(),
    }))
  },

  async postStats(token, _account, ids) {
    const out = new Map<string, Stats>()
    for (const id of ids) {
      const s = zeroStats()
      try {
        const p = await graph(id, token, { fields: 'shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)' })
        s.reactions = p.reactions?.summary?.total_count || 0
        s.comments = p.comments?.summary?.total_count || 0
        s.shares = p.shares?.count || 0
      } catch (err) {
        console.warn('[facebook] post fields', id, (err as Error).message)
      }
      s.impressions = lifetime((await metric(id, token, ['post_media_view', 'post_impressions'])).values)
      s.reach = lifetime((await metric(id, token, ['post_impressions_unique'])).values)
      s.clicks = lifetime((await metric(id, token, ['post_clicks'])).values)
      out.set(id, s)
    }
    return out
  },

  async followerCount(token, account) {
    const p = await graph(account.external_page_id, token, { fields: 'followers_count,fan_count' })
    return typeof p.followers_count === 'number' ? p.followers_count : (p.fan_count ?? null)
  },

  // Page insights per day, in 90-day windows (Meta's limit is 93).
  async dailyAccountStats(token, account, from, to) {
    const out = new Map<string, Stats>()
    const page = account.external_page_id
    for (let s = from.getTime(); s < to.getTime(); s += 90 * 86400000) {
      const e = Math.min(s + 90 * 86400000, to.getTime())
      const range = { period: 'day', since: String(Math.floor(s / 1000)), until: String(Math.floor(e / 1000)) }
      const pick = async (names: string[], key: keyof Stats) => {
        for (const v of (await metric(page, token, names, range)).values) {
          if (!v.end_time) continue
          const day = insightDay(v.end_time)
          const cur = out.get(day) || zeroStats()
          cur[key] = (Number(cur[key]) || 0) + (Number(v.value) || 0)
          out.set(day, cur)
        }
      }
      await pick(['page_media_view', 'page_impressions'], 'impressions')
      await pick(['page_impressions_unique'], 'reach')
      // Meta reports engagement as one number; it is stored as reactions so
      // engagement totals and rates stay meaningful.
      await pick(['page_post_engagements'], 'reactions')
    }
    return out
  },

  async dailyFollowerGains(token, account, from, to) {
    const out = new Map<string, number>()
    for (let s = from.getTime(); s < to.getTime(); s += 90 * 86400000) {
      const e = Math.min(s + 90 * 86400000, to.getTime())
      const { values } = await metric(account.external_page_id, token, ['page_daily_follows_unique', 'page_follows', 'page_fan_adds_unique'],
        { period: 'day', since: String(Math.floor(s / 1000)), until: String(Math.floor(e / 1000)) })
      for (const v of values) if (v.end_time) out.set(insightDay(v.end_time), Number(v.value) || 0)
    }
    return out
  },

  async listPosts(token, account, since): Promise<RemotePost[]> {
    const items = await graphAll(`${account.external_page_id}/published_posts`, token, {
      fields: 'id,message,created_time,permalink_url,attachments{media_type,type,subattachments.limit(2)}',
      since: Math.floor(since.getTime() / 1000), limit: 100,
    }, 1000)
    return items.map((p: any) => {
      const att = p.attachments?.data?.[0]
      const type = String(att?.media_type || att?.type || '').toLowerCase()
      return {
        externalId: p.id,
        url: p.permalink_url,
        caption: p.message || '',
        postType: type.includes('video') ? 'video' : type.includes('photo') || type.includes('album') ? 'image' : 'text',
        publishedAt: new Date(p.created_time).toISOString(),
      }
    })
  },
}
