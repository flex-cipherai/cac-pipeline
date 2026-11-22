// Account history: one analytics_snapshots row per account per day
// (period_date), from the platform's own daily totals, plus posts published
// outside the BMS. Used by sm-import-history (12 months, once) and by the
// hourly sync (last few days, to keep today's numbers current).

import { getConnector } from './platforms/index.ts'
import { type Account, type Db, zeroStats } from './platforms/types.ts'

const DAY = 86400000
const dayKey = (d: Date) => d.toISOString().slice(0, 10)
const rate = (s: { impressions: number; reactions: number; comments: number; shares: number }) =>
  s.impressions > 0 ? Number((((s.reactions + s.comments + s.shares) / s.impressions) * 100).toFixed(2)) : 0

// Upserts daily account rows for [from, to). Follower counts are rebuilt
// backwards from today's total using daily follower gains, when available.
export async function writeDailyAccountRows(db: Db, account: Account, token: string, from: Date, to: Date, currentFollowers: number | null) {
  const connector = getConnector(account.platform)
  if (!connector.dailyAccountStats) return 0
  const stats = await connector.dailyAccountStats(token, account, from, to)
  const gains = currentFollowers !== null && connector.dailyFollowerGains
    ? await connector.dailyFollowerGains(token, account, from, to).catch((e) => { console.warn('[history] gains:', e.message); return new Map<string, number>() })
    : new Map<string, number>()

  // Gains after day d, summed, so followers(end of d) = current − later gains.
  const days: string[] = []
  for (let t = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()); t < to.getTime(); t += DAY) days.push(dayKey(new Date(t)))
  const laterGains: Record<string, number> = {}
  let running = 0
  for (const d of [...days].reverse()) { laterGains[d] = running; running += gains.get(d) || 0 }

  const rows = days.map((d) => {
    const s = { ...zeroStats(), ...(stats.get(d) || {}) }
    return {
      account_id: account.id, post_id: null, period_date: d, captured_at: `${d}T12:00:00Z`, source: 'api',
      impressions: s.impressions, reach: s.reach, reactions: s.reactions, comments: s.comments, shares: s.shares,
      clicks: s.clicks, video_views: s.video_views || 0, engagement_rate: rate(s),
      follower_count: currentFollowers !== null ? Math.max(0, currentFollowers - laterGains[d]) : null,
    }
  })
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from('analytics_snapshots').upsert(rows.slice(i, i + 200), { onConflict: 'account_id,period_date' })
    if (error) throw new Error(`Saving daily analytics failed: ${error.message}`)
  }
  return rows.length
}

// One-time import: 12 months of daily totals + followers, and past posts with
// their lifetime stats (shown in Planner, Top posts, Best times).
export async function importHistory(db: Db, account: Account) {
  const connector = getConnector(account.platform)
  const token = await connector.getToken(db, account)
  const to = new Date()
  const from = new Date(to.getTime() - 365 * DAY)
  const notes: string[] = []

  let followers: number | null = null
  if (connector.capabilities(account).followers && connector.followerCount) {
    followers = await connector.followerCount(token, account).catch(() => null)
  }

  let days = 0
  try {
    days = await writeDailyAccountRows(db, account, token, from, to, followers)
  } catch (err) {
    notes.push(`daily totals: ${(err as Error).message}`)
  }

  let imported = 0
  if (connector.listPosts) {
    try {
      const remote = await connector.listPosts(token, account, from)
      const { data: known } = await db.from('posts').select('external_post_urn').eq('account_id', account.id).not('external_post_urn', 'is', null)
      const knownSet = new Set((known || []).map((p: { external_post_urn: string }) => p.external_post_urn))
      const fresh = remote.filter((p) => !knownSet.has(p.externalId))

      const stats = fresh.length && connector.postStats
        ? await connector.postStats(token, account, fresh.map((p) => p.externalId))
        : new Map()
      const now = new Date().toISOString()
      for (const p of fresh) {
        const s = stats.get(p.externalId) || null
        const { data: row, error } = await db.from('posts').insert({
          account_id: account.id, post_type: p.postType, caption: p.caption, hashtags: [], mentions: [],
          status: 'posted', posted_at: p.publishedAt, scheduled_at: p.publishedAt, mode: account.mode,
          external_post_urn: p.externalId, external_post_url: connector.postUrl(p.externalId),
          origin: 'imported', last_stats: s, stats_synced_at: s ? now : null,
        }).select('id').single()
        if (error || !row) { console.warn('[history] post insert:', error?.message); continue }
        // Lifetime stats as one post-level row at the post date, so Reports
        // and the post drill-down see them. Later syncs add only the changes.
        if (s) {
          await db.from('analytics_snapshots').insert({
            account_id: account.id, post_id: row.id, captured_at: p.publishedAt, source: 'api',
            impressions: s.impressions, reach: s.reach, reactions: s.reactions, comments: s.comments,
            shares: s.shares, clicks: s.clicks, engagement_rate: rate(s),
          })
        }
        imported++
      }
    } catch (err) {
      notes.push(`posts: ${(err as Error).message}`)
    }
  } else {
    notes.push('this platform does not let the BMS list past posts')
  }
  if (!connector.listPosts || account.account_type === 'member') {
    notes.push('past posts are not available for personal profiles — only daily totals')
  }

  const note = notes.join(' · ') || null
  await db.from('connected_accounts').update({ history_imported_at: new Date().toISOString(), history_import_note: note }).eq('id', account.id)
  return { days, posts: imported, followers, note }
}
