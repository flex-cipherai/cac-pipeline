// Hourly sync for every connected account in Automated Mode, on any
// platform with a connector (_shared/platforms):
//   1. Post analytics: lifetime stats for posts from the last 90 days,
//      refreshed at most every 6 hours per post. analytics_snapshots rows are
//      increments, so each sync stores the change since the last pull
//      (posts.last_stats), per post plus one account-level row.
//   2. Follower count (where the platform gives it), with milestone alerts.
//   3. New comments on the account's posts from the last 30 days → Inbox.
// Served by sm-sync (and the older sm-linkedin-sync name, kept as an alias).

import { getConnector, hasConnector } from './platforms/index.ts'
import { type Account, type Db, type Stats, zeroStats } from './platforms/types.ts'
import { staffWithModule } from './access.ts'
import { writeDailyAccountRows } from './socialHistory.ts'

const STATS_WINDOW_DAYS = 90
const COMMENTS_WINDOW_DAYS = 30
const STATS_SPACING_MS = 6 * 60 * 60 * 1000
const MILESTONES = [100, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000]
const METRICS = ['impressions', 'reach', 'reactions', 'comments', 'shares', 'clicks'] as const

const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString()
const rate = (s: Stats) => s.impressions > 0 ? Number((((s.reactions + s.comments + s.shares) / s.impressions) * 100).toFixed(2)) : 0

async function syncStats(db: Db, account: Account, token: string, force: boolean) {
  const connector = getConnector(account.platform)
  const caps = connector.capabilities(account)
  const { data: posts } = await db
    .from('posts')
    .select('id, external_post_urn, last_stats, stats_synced_at')
    .eq('account_id', account.id)
    .eq('status', 'posted')
    .not('external_post_urn', 'is', null)
    .gte('posted_at', daysAgo(STATS_WINDOW_DAYS))

  const due = (posts || []).filter((p: { stats_synced_at: string | null }) =>
    force || !p.stats_synced_at || Date.now() - new Date(p.stats_synced_at).getTime() > STATS_SPACING_MS)

  const current = caps.postStats && connector.postStats && due.length
    ? await connector.postStats(token, account, due.map((p: { external_post_urn: string }) => p.external_post_urn))
    : new Map<string, Stats>()

  const capturedAt = new Date().toISOString()
  const accountDelta = zeroStats()
  const rows = []
  for (const p of due) {
    const now = current.get(p.external_post_urn)
    if (!now) continue
    const last: Stats = { ...zeroStats(), ...(p.last_stats || {}) }
    const delta = zeroStats()
    let changed = false
    for (const k of METRICS) {
      delta[k] = Math.max(0, (now[k] || 0) - (last[k] || 0))
      accountDelta[k] += delta[k]
      if (delta[k] > 0) changed = true
    }
    if (changed) rows.push({ account_id: account.id, post_id: p.id, captured_at: capturedAt, source: 'api', ...delta, engagement_rate: rate(delta) })
    await db.from('posts').update({ last_stats: now, stats_synced_at: capturedAt }).eq('id', p.id)
  }

  let followers: number | null = null
  if (caps.followers && connector.followerCount) {
    try { followers = await connector.followerCount(token, account) } catch (err) { console.warn('[sync] followers:', (err as Error).message) }
  }
  // Previous follower count = the latest one recorded before today.
  let previous: number | null = null
  if (followers !== null) {
    const todayStart = `${new Date().toISOString().slice(0, 10)}T00:00:00Z`
    const { data: prev } = await db.from('analytics_snapshots').select('follower_count')
      .eq('account_id', account.id).is('post_id', null).not('follower_count', 'is', null)
      .lt('captured_at', todayStart)
      .order('captured_at', { ascending: false }).limit(1).maybeSingle()
    previous = prev?.follower_count ?? null
  }

  // Account level: platforms with daily totals get one row per day (the last
  // 3 days refreshed, so late-arriving numbers are picked up); others get an
  // increment row built from the post changes above.
  let dailyRows = 0
  if (connector.dailyAccountStats) {
    const now = new Date()
    dailyRows = await writeDailyAccountRows(db, account, token, new Date(now.getTime() - 3 * 86400000), now, followers)
  } else if (METRICS.some((k) => accountDelta[k] > 0) || (followers !== null && followers !== previous)) {
    rows.push({ account_id: account.id, post_id: null, captured_at: capturedAt, source: 'api', ...accountDelta, engagement_rate: rate(accountDelta), follower_count: followers })
  }
  if (rows.length) {
    const { error } = await db.from('analytics_snapshots').insert(rows)
    if (error) throw new Error(`Saving analytics failed: ${error.message}`)
  }

  if (followers !== null && previous !== null) {
    const crossed = MILESTONES.filter((m) => previous! < m && followers! >= m).pop()
    if (crossed) await followerMilestone(db, account, crossed, followers)
  }
  return { posts: due.length, snapshots: rows.length, days: dailyRows, followers }
}

async function followerMilestone(db: Db, account: Account, milestone: number, count: number) {
  await db.from('activity_events').insert({
    account_id: account.id, event_type: 'follower_milestone', triage_status: 'handled', source: 'api',
    content: `${account.account_name} reached ${milestone.toLocaleString()} followers (${count.toLocaleString()} now)`,
    external_id: `follower_milestone:${account.id}:${milestone}`,
  })
  await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/sm-notify-event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
    body: JSON.stringify({ event: 'follower_milestone', milestone, current_count: count, account_name: account.account_name }),
  }).catch((e) => console.warn('[sync] milestone alert:', e.message))
}

async function syncComments(db: Db, account: Account, token: string) {
  const connector = getConnector(account.platform)
  if (!connector.capabilities(account).comments || !connector.listComments) return 0
  const { data: posts } = await db.from('posts')
    .select('id, external_post_urn, external_post_url')
    .eq('account_id', account.id).eq('status', 'posted').not('external_post_urn', 'is', null)
    .gte('posted_at', daysAgo(COMMENTS_WINDOW_DAYS))

  const rows = []
  for (const p of posts || []) {
    try {
      for (const c of await connector.listComments(token, account, p.external_post_urn)) {
        if (c.authorIsSelf) continue // our own replies are stored when sent
        rows.push({
          account_id: account.id, post_id: p.id, event_type: 'comment', direction: 'inbound',
          content: c.text, author_name: c.authorName, occurred_at: c.createdAt,
          external_url: p.external_post_url || connector.postUrl(p.external_post_urn),
          external_id: c.externalId, parent_external_id: c.parentExternalId || null,
          source: 'api', triage_status: 'needs_response',
        })
      }
    } catch (err) {
      console.warn(`[sync] comments for ${p.external_post_urn}:`, (err as Error).message)
    }
  }
  if (!rows.length) return 0
  const { data: inserted, error } = await db.from('activity_events')
    .upsert(rows, { onConflict: 'external_id', ignoreDuplicates: true }).select('id')
  if (error) throw new Error(`Saving comments failed: ${error.message}`)
  const fresh = inserted?.length || 0
  if (fresh > 0) {
    const recipients = await staffWithModule(db, 'social_activity', ['admin', 'marketing'], 'id')
    await db.from('in_app_notifications').insert(recipients.map((r: { id: string }) => ({
      user_id: r.id, type: 'new_comments',
      title: `${fresh} new comment${fresh === 1 ? '' : 's'} on ${account.account_name}`,
      body: 'Reply from the Inbox.', link: '/social/activity',
    })))
  }
  return fresh
}

export async function runSocialSync(db: Db, force = false) {
  const { data: accounts } = await db.from('connected_accounts').select('*')
    .eq('mode', 'automated').eq('status', 'active').not('external_page_id', 'is', null)

  const report: Record<string, unknown> = {}
  for (const account of (accounts || []) as Account[]) {
    if (!hasConnector(account.platform)) continue
    try {
      const token = await getConnector(account.platform).getToken(db, account)
      const stats = await syncStats(db, account, token, force)
      const comments = await syncComments(db, account, token)
      await db.from('connected_accounts').update({ last_synced_at: new Date().toISOString(), last_sync_error: null }).eq('id', account.id)
      report[`${account.platform}: ${account.account_name}`] = { ...stats, new_comments: comments }
    } catch (err) {
      const message = (err as Error).message
      await db.from('connected_accounts').update({ last_sync_error: message.slice(0, 500) }).eq('id', account.id)
      report[`${account.platform}: ${account.account_name}`] = { error: message }
    }
  }
  return report
}
