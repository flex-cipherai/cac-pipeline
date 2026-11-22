// Supabase Edge Function: sm-linkedin-sync
// Hourly (pg_cron). For every LinkedIn account in Automated Mode:
//   1. Post analytics — lifetime stats for posts published from the BMS in
//      the last 90 days, refreshed at most every 6 hours per post.
//      analytics_snapshots rows are *increments* (Social Analytics adds
//      them up), so each sync stores the change since the previous pull
//      (posts.last_stats), per post and as one account-level row.
//        Company Page: organizationalEntityShareStatistics (rw_organization_admin)
//        Profile:      memberCreatorPostAnalytics (r_member_postAnalytics)
//   2. Company Page follower count (networkSizes) on the account-level row,
//      with a milestone alert when it crosses 100 / 500 / 1,000 / ...
//   3. New comments on Company Page posts from the last 30 days → Activity
//      Inbox (r_organization_social_feed). Comments on profile posts need a
//      scope LinkedIn does not grant this app, so they are not synced.
//
// Body (optional): { force: true } ignores the 6-hour stats spacing — used by
// "Sync now" in Settings → Integrations.
//
// Deploy: supabase functions deploy sm-linkedin-sync --no-verify-jwt
// Schedule: see migration-social-linkedin-sync-cron.sql

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getValidLinkedInAccessToken, liFetch, postUrlFor } from '../_shared/linkedin.ts'
import { staffWithModule } from '../_shared/access.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const STATS_WINDOW_DAYS = 90
const COMMENTS_WINDOW_DAYS = 30
const STATS_SPACING_MS = 6 * 60 * 60 * 1000
const MILESTONES = [100, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000]
const METRICS = ['impressions', 'reach', 'reactions', 'comments', 'shares', 'clicks'] as const
type Stats = Record<(typeof METRICS)[number], number>

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const zeroStats = (): Stats => ({ impressions: 0, reach: 0, reactions: 0, comments: 0, shares: 0, clicks: 0 })
const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString()

// ── Stats fetchers ──────────────────────────────────────────────

async function orgPostStats(token: string, orgUrn: string, postUrns: string[]): Promise<Map<string, Stats>> {
  const out = new Map<string, Stats>()
  const shares = postUrns.filter((u) => u.startsWith('urn:li:share:'))
  const ugc = postUrns.filter((u) => u.startsWith('urn:li:ugcPost:'))
  const base = `/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${encodeURIComponent(orgUrn)}`

  for (const [param, urns] of [['shares', shares], ['ugcPosts', ugc]] as const) {
    for (let i = 0; i < urns.length; i += 20) {
      const batch = urns.slice(i, i + 20)
      const { data } = await liFetch(token, `${base}&${param}=List(${batch.map(encodeURIComponent).join(',')})`)
      for (const el of data?.elements || []) {
        const urn = el.share || el.ugcPost
        const s = el.totalShareStatistics || {}
        if (!urn) continue
        out.set(urn, {
          impressions: s.impressionCount || 0,
          reach: s.uniqueImpressionsCount || 0,
          reactions: s.likeCount || 0,
          comments: s.commentCount || 0,
          shares: s.shareCount || 0,
          clicks: s.clickCount || 0,
        })
      }
    }
  }
  // Posts with no activity are left out of the response: they are zero.
  for (const urn of postUrns) if (!out.has(urn)) out.set(urn, zeroStats())
  return out
}

const MEMBER_QUERIES: [keyof Stats, string][] = [
  ['impressions', 'IMPRESSION'],
  ['reach', 'MEMBERS_REACHED'],
  ['reactions', 'REACTION'],
  ['comments', 'COMMENT'],
  ['shares', 'RESHARE'],
  ['clicks', 'LINK_CLICKS'],
]

async function memberPostStats(token: string, postUrn: string): Promise<Stats> {
  const entity = postUrn.startsWith('urn:li:ugcPost:')
    ? `(ugc:${encodeURIComponent(postUrn)})`
    : `(share:${encodeURIComponent(postUrn)})`
  const stats = zeroStats()
  for (const [key, queryType] of MEMBER_QUERIES) {
    try {
      const { data } = await liFetch(token, `/memberCreatorPostAnalytics?q=entity&entity=${entity}&queryType=${queryType}&aggregation=TOTAL`)
      stats[key] = (data?.elements || []).reduce((sum: number, el: { count?: number }) => sum + (el.count || 0), 0)
    } catch (err) {
      // One unsupported metric should not lose the others.
      console.warn(`[sm-linkedin-sync] ${queryType} for ${postUrn}:`, (err as Error).message)
    }
  }
  return stats
}

// ── Per-account sync ────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function syncStats(db: any, account: any, token: string, force: boolean) {
  const { data: posts } = await db
    .from('posts')
    .select('id, external_post_urn, last_stats, stats_synced_at')
    .eq('account_id', account.id)
    .eq('status', 'posted')
    .not('external_post_urn', 'is', null)
    .gte('posted_at', daysAgo(STATS_WINDOW_DAYS))

  const due = (posts || []).filter((p: { stats_synced_at: string | null }) =>
    force || !p.stats_synced_at || Date.now() - new Date(p.stats_synced_at).getTime() > STATS_SPACING_MS
  )

  const isOrg = account.account_type === 'organization'
  const current = new Map<string, Stats>()
  if (isOrg && due.length) {
    const map = await orgPostStats(token, account.external_page_id, due.map((p: { external_post_urn: string }) => p.external_post_urn))
    map.forEach((v, k) => current.set(k, v))
  } else {
    for (const p of due) current.set(p.external_post_urn, await memberPostStats(token, p.external_post_urn))
  }

  const capturedAt = new Date().toISOString()
  const accountDelta = zeroStats()
  const snapshotRows = []
  for (const p of due) {
    const now = current.get(p.external_post_urn) || zeroStats()
    const last: Stats = { ...zeroStats(), ...(p.last_stats || {}) }
    const delta = zeroStats()
    let any = false
    for (const k of METRICS) {
      delta[k] = Math.max(0, (now[k] || 0) - (last[k] || 0))
      accountDelta[k] += delta[k]
      if (delta[k] > 0) any = true
    }
    if (any) {
      snapshotRows.push({
        account_id: account.id, post_id: p.id, captured_at: capturedAt, source: 'api', ...delta,
        engagement_rate: delta.impressions > 0
          ? Number((((delta.reactions + delta.comments + delta.shares) / delta.impressions) * 100).toFixed(2))
          : 0,
      })
    }
    await db.from('posts').update({ last_stats: now, stats_synced_at: capturedAt }).eq('id', p.id)
  }

  // Follower count (Company Page only).
  let followerCount: number | null = null
  if (isOrg) {
    try {
      const { data } = await liFetch(token, `/networkSizes/${encodeURIComponent(account.external_page_id)}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`)
      followerCount = typeof data?.firstDegreeSize === 'number' ? data.firstDegreeSize : null
    } catch (err) {
      console.warn('[sm-linkedin-sync] networkSizes:', (err as Error).message)
    }
  }

  let previousFollowers: number | null = null
  if (followerCount !== null) {
    const { data: prev } = await db
      .from('analytics_snapshots').select('follower_count')
      .eq('account_id', account.id).is('post_id', null).not('follower_count', 'is', null)
      .order('captured_at', { ascending: false }).limit(1).maybeSingle()
    previousFollowers = prev?.follower_count ?? null
  }

  const anyAccountDelta = METRICS.some((k) => accountDelta[k] > 0)
  if (anyAccountDelta || (followerCount !== null && followerCount !== previousFollowers)) {
    snapshotRows.push({
      account_id: account.id, post_id: null, captured_at: capturedAt, source: 'api', ...accountDelta,
      engagement_rate: accountDelta.impressions > 0
        ? Number((((accountDelta.reactions + accountDelta.comments + accountDelta.shares) / accountDelta.impressions) * 100).toFixed(2))
        : 0,
      follower_count: followerCount,
    })
  }
  if (snapshotRows.length) {
    const { error } = await db.from('analytics_snapshots').insert(snapshotRows)
    if (error) throw new Error(`Saving analytics failed: ${error.message}`)
  }

  if (followerCount !== null && previousFollowers !== null) {
    const crossed = MILESTONES.filter((m) => previousFollowers! < m && followerCount! >= m).pop()
    if (crossed) await followerMilestone(db, account, crossed, followerCount)
  }

  return { posts: due.length, snapshots: snapshotRows.length, followers: followerCount }
}

// deno-lint-ignore no-explicit-any
async function followerMilestone(db: any, account: any, milestone: number, count: number) {
  await db.from('activity_events').insert({
    account_id: account.id,
    event_type: 'follower_milestone',
    content: `${account.account_name} reached ${milestone.toLocaleString()} followers (${count.toLocaleString()} now)`,
    triage_status: 'handled',
    source: 'api',
    external_id: `follower_milestone:${account.id}:${milestone}`,
  })
  // Same alert as a manually logged milestone (in-app + email).
  await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/sm-notify-event`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
    },
    body: JSON.stringify({ event: 'follower_milestone', milestone, current_count: count, account_name: account.account_name }),
  }).catch((e) => console.warn('[sm-linkedin-sync] milestone alert:', e.message))
}

// deno-lint-ignore no-explicit-any
async function syncComments(db: any, account: any, token: string) {
  const { data: posts } = await db
    .from('posts')
    .select('id, external_post_urn, external_post_url')
    .eq('account_id', account.id)
    .eq('status', 'posted')
    .not('external_post_urn', 'is', null)
    .gte('posted_at', daysAgo(COMMENTS_WINDOW_DAYS))

  const rows = []
  for (const p of posts || []) {
    try {
      const { data } = await liFetch(token, `/socialActions/${encodeURIComponent(p.external_post_urn)}/comments`)
      for (const c of data?.elements || []) {
        if (c.actor === account.external_page_id) continue // our own replies
        const externalId = c.commentUrn || `${p.external_post_urn}:comment:${c.id}`
        rows.push({
          account_id: account.id,
          post_id: p.id,
          event_type: 'comment',
          content: c.message?.text || '',
          author_name: String(c.actor || '').startsWith('urn:li:organization:') ? 'A LinkedIn page' : 'LinkedIn member',
          occurred_at: c.created?.time ? new Date(c.created.time).toISOString() : new Date().toISOString(),
          external_url: p.external_post_url || postUrlFor(p.external_post_urn),
          external_id: externalId,
          source: 'api',
          triage_status: 'needs_response',
        })
      }
    } catch (err) {
      console.warn(`[sm-linkedin-sync] comments for ${p.external_post_urn}:`, (err as Error).message)
    }
  }
  if (!rows.length) return 0

  const { data: inserted, error } = await db
    .from('activity_events')
    .upsert(rows, { onConflict: 'external_id', ignoreDuplicates: true })
    .select('id')
  if (error) throw new Error(`Saving comments failed: ${error.message}`)
  const newCount = inserted?.length || 0

  if (newCount > 0) {
    const recipients = await staffWithModule(db, 'social_activity', ['admin', 'marketing'], 'id')
    await db.from('in_app_notifications').insert(recipients.map((r: { id: string }) => ({
      user_id: r.id,
      type: 'new_comments',
      title: `${newCount} new LinkedIn comment${newCount === 1 ? '' : 's'}`,
      body: `On ${account.account_name} posts — reply on LinkedIn and triage in the Activity Inbox.`,
      link: '/social/activity',
    })))
  }
  return newCount
}

// ── Entry ───────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const body = await req.json().catch(() => ({}))
    const force = body?.force === true

    const { data: accounts } = await db
      .from('connected_accounts')
      .select('*')
      .eq('platform', 'linkedin')
      .eq('mode', 'automated')
      .eq('status', 'active')
      .not('external_page_id', 'is', null)

    const report: Record<string, unknown> = {}
    for (const account of accounts || []) {
      try {
        const token = await getValidLinkedInAccessToken(db, account.id)
        const stats = await syncStats(db, account, token, force)
        const comments = account.account_type === 'organization' ? await syncComments(db, account, token) : 0
        await db.from('connected_accounts').update({ last_synced_at: new Date().toISOString(), last_sync_error: null }).eq('id', account.id)
        report[account.account_name] = { ...stats, new_comments: comments }
      } catch (err) {
        const message = (err as Error).message
        await db.from('connected_accounts').update({ last_sync_error: message.slice(0, 500) }).eq('id', account.id)
        report[account.account_name] = { error: message }
      }
    }

    return jsonResponse({ success: true, accounts: report })
  } catch (error) {
    return jsonResponse({ success: false, error: (error as Error).message }, 500)
  }
})
