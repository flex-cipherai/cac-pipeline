// Supabase Edge Function: sm-reports
// Scheduled social media reports (Metricool-style). Runs daily (pg_cron,
// 04:00 UTC = 07:00 Nairobi) and emails every report_schedules row that is
// due: weekly ones on their send_weekday (covering the previous 7 days),
// monthly ones on the 1st (covering the previous calendar month). Each
// report compares against the period before.
//
// Body:
//   {}                                  → cron: send what is due
//   { schedule_id, send_now: true }     → "Send now" from the Reports page
//                                          (signed-in user with Reports access)
//
// Deploy: supabase functions deploy sm-reports --no-verify-jwt
// Requires: RESEND_API_KEY, SENDER_EMAIL

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendViaResend } from '../_shared/resend.ts'
import { staffWithModule, userHasModule } from '../_shared/access.ts'
import { zonedDay } from '../_shared/zoned.ts'

const TZ = 'Africa/Nairobi'
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const WEEKDAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

function periodFor(frequency: string, now: Date) {
  if (frequency === 'monthly') {
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    const prevStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1))
    return { start, end, prevStart, prevEnd: start }
  }
  const end = new Date(now)
  const start = new Date(now.getTime() - 7 * 86400000)
  return { start, end, prevStart: new Date(start.getTime() - 7 * 86400000), prevEnd: start }
}

// deno-lint-ignore no-explicit-any
async function buildReport(db: any, schedule: any, now: Date) {
  const { start, end, prevStart, prevEnd } = periodFor(schedule.frequency, now)
  const { data: allAccounts } = await db.from('connected_accounts').select('id, account_name, platform, account_type')
  const accounts = (allAccounts || []).filter((a: { id: string }) => !schedule.account_ids?.length || schedule.account_ids.includes(a.id))
  const ids = accounts.map((a: { id: string }) => a.id)
  if (!ids.length) return null

  // deno-lint-ignore no-explicit-any
  const sumRange = async (from: Date, to: Date): Promise<any> => {
    const { data } = await db.from('analytics_snapshots')
      .select('impressions, reactions, comments, shares, clicks, follower_count, captured_at, account_id')
      .is('post_id', null).in('account_id', ids).gte('captured_at', from.toISOString()).lt('captured_at', to.toISOString())
    const rows = data || []
    const s = (k: string) => rows.reduce((t: number, r: Record<string, number>) => t + (Number(r[k]) || 0), 0)
    const engagement = s('reactions') + s('comments') + s('shares')
    const impressions = s('impressions')
    const { count } = await db.from('posts').select('id', { count: 'exact', head: true })
      .in('account_id', ids).eq('status', 'posted').gte('posted_at', from.toISOString()).lt('posted_at', to.toISOString())
    return { impressions, engagement, clicks: s('clicks'), rate: impressions ? (engagement / impressions) * 100 : 0, posts: count || 0 }
  }
  const cur = await sumRange(start, end)
  const prev = await sumRange(prevStart, prevEnd)

  // Followers: latest known count per account, now vs. at the period start.
  let followersNow = 0, followersThen = 0
  for (const id of ids) {
    const latest = await db.from('analytics_snapshots').select('follower_count').eq('account_id', id).is('post_id', null)
      .not('follower_count', 'is', null).lt('captured_at', end.toISOString()).order('captured_at', { ascending: false }).limit(1).maybeSingle()
    const then = await db.from('analytics_snapshots').select('follower_count').eq('account_id', id).is('post_id', null)
      .not('follower_count', 'is', null).lt('captured_at', start.toISOString()).order('captured_at', { ascending: false }).limit(1).maybeSingle()
    followersNow += latest.data?.follower_count || 0
    followersThen += then.data?.follower_count || latest.data?.follower_count || 0
  }

  // Top posts and formats from post-level snapshots in the period.
  const { data: postRows } = await db.from('analytics_snapshots')
    .select('post_id, impressions, reactions, comments, shares, clicks, posts(caption, post_type, external_post_url, account_id)')
    .not('post_id', 'is', null).in('account_id', ids).gte('captured_at', start.toISOString()).lt('captured_at', end.toISOString())
  // deno-lint-ignore no-explicit-any
  const byPost = new Map<string, any>()
  const byFormat = new Map<string, { posts: Set<string>; impressions: number; engagement: number }>()
  for (const r of postRows || []) {
    const e = (r.reactions || 0) + (r.comments || 0) + (r.shares || 0)
    const p = byPost.get(r.post_id) || { ...r.posts, impressions: 0, engagement: 0 }
    p.impressions += r.impressions || 0; p.engagement += e
    byPost.set(r.post_id, p)
    const f = byFormat.get(r.posts?.post_type || 'text') || { posts: new Set(), impressions: 0, engagement: 0 }
    f.posts.add(r.post_id); f.impressions += r.impressions || 0; f.engagement += e
    byFormat.set(r.posts?.post_type || 'text', f)
  }
  const topPosts = [...byPost.values()].sort((a, b) => b.engagement - a.engagement || b.impressions - a.impressions).slice(0, 5)

  const { data: bt } = await db.from('social_best_times').select('*').in('account_id', ids)
  // deno-lint-ignore no-explicit-any
  const bestTimes = (bt || []).filter((b: any) => b.posts >= 1).sort((a: any, b: any) => (b.avg_engagement_rate || 0) - (a.avg_engagement_rate || 0)).slice(0, 3)

  return { start, end, accounts, cur, prev, followersNow, followersThen, topPosts, formats: [...byFormat.entries()], bestTimes }
}

function delta(cur: number, prev: number) {
  if (!prev) return cur ? '<span style="color:#15803d">new</span>' : '<span style="color:#999">—</span>'
  const pct = ((cur - prev) / prev) * 100
  const color = pct >= 0 ? '#15803d' : '#EC3013'
  return `<span style="color:${color}">${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(0)}%</span>`
}

// deno-lint-ignore no-explicit-any
function renderHtml(schedule: any, r: any, appUrl: string) {
  const range = `${r.start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${new Date(r.end.getTime() - 1).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
  const tile = (label: string, value: string, d: string) => `
    <td style="padding:6px;width:33%"><div style="background:#fff;border-radius:8px;padding:14px">
      <div style="font-size:12px;color:#666">${label}</div>
      <div style="font-size:22px;font-weight:700;margin:4px 0">${value}</div>
      <div style="font-size:12px">${d} <span style="color:#999">vs previous</span></div></div></td>`
  const sections: string[] = schedule.sections || []
  let html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:620px;margin:0 auto;color:#201E1D">
  <div style="padding:28px 0 18px;text-align:center"><span style="font-size:22px;font-weight:700;color:#EC3013">SDFM GROUP</span>
  <span style="font-size:12px;display:block;letter-spacing:.15em">LIMITED</span></div>
  <div style="background:#F3F2F2;border-radius:10px;padding:24px">
  <h1 style="font-size:20px;margin:0 0 4px">${esc(schedule.name)}</h1>
  <p style="font-size:13px;color:#666;margin:0 0 16px">${range} · ${r.accounts.map((a: { account_name: string }) => esc(a.account_name)).join(', ')}</p>`

  if (sections.includes('overview')) {
    html += `<table style="width:100%;border-collapse:collapse"><tr>
      ${tile('Impressions', fmt(r.cur.impressions), delta(r.cur.impressions, r.prev.impressions))}
      ${tile('Engagements', fmt(r.cur.engagement), delta(r.cur.engagement, r.prev.engagement))}
      ${tile('Engagement rate', `${r.cur.rate.toFixed(2)}%`, delta(r.cur.rate, r.prev.rate))}</tr><tr>
      ${tile('Clicks', fmt(r.cur.clicks), delta(r.cur.clicks, r.prev.clicks))}
      ${tile('Posts published', fmt(r.cur.posts), delta(r.cur.posts, r.prev.posts))}
      ${tile('Followers', fmt(r.followersNow), `${r.followersNow - r.followersThen >= 0 ? '+' : ''}${fmt(r.followersNow - r.followersThen)}`)}</tr></table>`
  }
  if (sections.includes('top_posts')) {
    html += `<h2 style="font-size:15px;margin:20px 0 8px">Top posts</h2>`
    html += r.topPosts.length ? r.topPosts.map((p: any) => `<div style="background:#fff;border-radius:8px;padding:12px;margin-bottom:8px;border-left:4px solid #EC3013">
      <div style="font-size:13px">${esc((p.caption || '(no caption)').slice(0, 140))}${(p.caption || '').length > 140 ? '…' : ''}</div>
      <div style="font-size:12px;color:#666;margin-top:6px">${fmt(p.impressions)} impressions · ${fmt(p.engagement)} engagements
      ${p.external_post_url ? ` · <a href="${esc(p.external_post_url)}" style="color:#EC3013">View</a>` : ''}</div></div>`).join('')
      : '<p style="font-size:13px;color:#666">No post activity in this period.</p>'
  }
  if (sections.includes('formats') && r.formats.length) {
    html += `<h2 style="font-size:15px;margin:20px 0 8px">By format</h2><table style="width:100%;font-size:13px;background:#fff;border-radius:8px">
      <tr style="color:#666"><td style="padding:8px">Format</td><td>Posts</td><td>Impressions</td><td>Engagements</td></tr>
      ${r.formats.map(([k, f]: [string, any]) => `<tr><td style="padding:8px">${esc(k)}</td><td>${f.posts.size}</td><td>${fmt(f.impressions)}</td><td>${fmt(f.engagement)}</td></tr>`).join('')}</table>`
  }
  if (sections.includes('best_times') && r.bestTimes.length) {
    html += `<h2 style="font-size:15px;margin:20px 0 8px">Best times to post</h2><p style="font-size:13px;margin:0">
      ${r.bestTimes.map((b: any) => `${WEEKDAYS[b.weekday]} ${String(b.hour).padStart(2, '0')}:00 (${Number(b.avg_engagement_rate || 0).toFixed(1)}% engagement)`).join(' · ')}</p>`
  }
  html += `<p style="font-size:13px;margin:20px 0 0">Full analytics: <a href="${appUrl}/social/analytics" style="color:#EC3013;font-weight:600">open in the BMS</a></p>
  </div><p style="font-size:12px;color:#999;text-align:center">SDFM Group Limited · Transforming Kenyan Businesses</p></div>`
  return html
}

// deno-lint-ignore no-explicit-any
function isDue(schedule: any, now: Date) {
  const { date, weekday } = zonedDay(now, TZ)
  if (schedule.last_sent_at && zonedDay(new Date(schedule.last_sent_at), TZ).date === date) return false
  return schedule.frequency === 'monthly' ? date.endsWith('-01') : weekday === schedule.send_weekday
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const db = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const body = await req.json().catch(() => ({}))
    const now = new Date()

    // deno-lint-ignore no-explicit-any
    let schedules: any[] = []
    if (body?.send_now) {
      const authHeader = req.headers.get('Authorization') || ''
      const anon = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } })
      const { data: { user } } = await anon.auth.getUser()
      if (!user || !(await userHasModule(db, user.id, 'social_reports', ['admin', 'marketing']))) {
        return jsonResponse({ success: false, error: 'You do not have access to Reports' })
      }
      const { data } = await db.from('report_schedules').select('*').eq('id', body.schedule_id).maybeSingle()
      if (!data) return jsonResponse({ success: false, error: 'Report not found' })
      schedules = [data]
    } else {
      const { data } = await db.from('report_schedules').select('*').eq('active', true)
      schedules = (data || []).filter((s) => isDue(s, now))
    }

    const { data: baseUrlRow } = await db.from('system_settings').select('value').eq('key', 'app_base_url').maybeSingle()
    const appUrl = (baseUrlRow?.value || '').replace(/\/$/, '')
    const sent: Record<string, number | string> = {}

    for (const schedule of schedules) {
      const report = await buildReport(db, schedule, now)
      if (!report) { sent[schedule.name] = 'no accounts'; continue }
      let to: string[] = (schedule.recipients || []).filter(Boolean)
      if (!to.length) {
        const staff = await staffWithModule(db, 'social_reports', ['admin', 'marketing'], 'email')
        to = staff.map((s: { email?: string }) => s.email).filter(Boolean) as string[]
      }
      if (!to.length) { sent[schedule.name] = 'no recipients'; continue }
      const subject = `${schedule.name} — ${report.start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} to ${new Date(report.end.getTime() - 1).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
      const html = renderHtml(schedule, report, appUrl)
      const results = await Promise.allSettled(to.map((email) => sendViaResend([email], subject, html)))
      const ok = results.filter((r) => r.status === 'fulfilled').length
      if (ok > 0) await db.from('report_schedules').update({ last_sent_at: now.toISOString() }).eq('id', schedule.id)
      sent[schedule.name] = ok
    }
    return jsonResponse({ success: true, sent })
  } catch (err) {
    return jsonResponse({ success: false, error: (err as Error).message }, 500)
  }
})
