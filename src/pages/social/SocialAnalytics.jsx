import { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { DateTime } from 'luxon'
import { supabase } from '../../lib/supabase'
import { exportCSV, exportSocialAnalyticsPDF } from '../../lib/exportUtils'
import { isQualified } from '../../lib/scoring'
import { useSocialAccounts } from '../../lib/socialAccounts'
import { platformOf, POST_TYPE_LABELS } from '../../lib/platforms'
import { fetchBestTimes, MIN_POSTS } from '../../lib/bestTimes'
import { AccountBar, AccountAvatar, SocialHeader, StatTile, TrendChart, Heatmap, EmptyState } from '../../components/social/SocialUI'
import './SocialAnalytics.css'

const RANGES = [
  { key: '7d', label: 'Last 7 days' },
  { key: '28d', label: 'Last 28 days' },
  { key: '90d', label: 'Last 90 days' },
  { key: 'month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'custom', label: 'Custom' },
]

const SORTS = { engagement: 'Engagements', impressions: 'Impressions', rate: 'Engagement rate', clicks: 'Clicks', comments: 'Comments' }
const WEEKDAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function rangeFor(key, custom) {
  const now = DateTime.now()
  switch (key) {
    case '7d': return { start: now.minus({ days: 7 }).startOf('day'), end: now }
    case '90d': return { start: now.minus({ days: 90 }).startOf('day'), end: now }
    case 'month': return { start: now.startOf('month'), end: now }
    case 'last_month': return { start: now.minus({ months: 1 }).startOf('month'), end: now.minus({ months: 1 }).endOf('month') }
    case 'custom': {
      const s = DateTime.fromISO(custom.start || ''), e = DateTime.fromISO(custom.end || '')
      if (s.isValid && e.isValid && s <= e) return { start: s.startOf('day'), end: e.endOf('day') }
      return { start: now.minus({ days: 28 }).startOf('day'), end: now }
    }
    default: return { start: now.minus({ days: 28 }).startOf('day'), end: now }
  }
}

const num = v => Number(v) || 0
const engagementOf = s => num(s.reactions) + num(s.comments) + num(s.shares)

function emptyMetrics() {
  return { impressions: '', reach: '', reactions: '', comments: '', shares: '', clicks: '', video_views: '', follower_count: '' }
}

// Analytics (Metricool-style): pick accounts and a range; everything is
// compared with the period before. Account totals come from account-level
// analytics_snapshots (increments synced hourly, or logged/imported by hand);
// post performance from each post's lifetime stats.
export default function SocialAnalytics() {
  const { accounts, selected, selectedIds, setSelected, loading: accountsLoading } = useSocialAccounts()
  const [rangeKey, setRangeKey] = useState(() => { try { return localStorage.getItem('sm.analyticsRange') || '28d' } catch { return '28d' } })
  const [custom, setCustom] = useState({ start: '', end: '' })
  const [data, setData] = useState(null)
  const [best, setBest] = useState({ cells: [], isDefault: true, sample: 0 })
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState('engagement')
  const [breakdown, setBreakdown] = useState('format')
  const [drill, setDrill] = useState(null)
  const [showLog, setShowLog] = useState(false)
  const [log, setLog] = useState({ account_id: '', post_id: '', date: DateTime.now().toISODate(), fields: emptyMetrics() })
  const [toast, setToast] = useState(null)
  const csvRef = useRef(null)

  const range = useMemo(() => rangeFor(rangeKey, custom), [rangeKey, custom])
  const prev = useMemo(() => {
    const len = range.end.diff(range.start)
    return { start: range.start.minus(len), end: range.start }
  }, [range])
  const visibleAccounts = useMemo(() => accounts.filter(a => selectedIds.includes(a.id)), [accounts, selectedIds])
  const accountById = useMemo(() => Object.fromEntries(accounts.map(a => [a.id, a])), [accounts])

  function showToast(type, text) { setToast({ type, text }); setTimeout(() => setToast(null), 4000) }

  function pickRange(k) {
    setRangeKey(k)
    try { localStorage.setItem('sm.analyticsRange', k) } catch { /* ignore */ }
  }

  useEffect(() => { if (!accountsLoading) load() }, [accountsLoading, selectedIds.join(','), range]) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true)
    const ids = selectedIds.length ? selectedIds : ['00000000-0000-0000-0000-000000000000']
    const platforms = [...new Set(visibleAccounts.map(a => platformOf(a).name.toLowerCase()))]
    const [snapRes, postsRes, followersRes, campaignsRes, leadsRes] = await Promise.all([
      supabase.from('analytics_snapshots').select('*').is('post_id', null).in('account_id', ids)
        .gte('captured_at', prev.start.toISO()).lte('captured_at', range.end.toISO()).order('captured_at'),
      supabase.from('posts')
        .select('id, account_id, caption, post_type, posted_at, external_post_url, last_stats, campaign_id, content_pillars(name), content_campaigns(name)')
        .eq('status', 'posted').eq('is_template', false).in('account_id', ids)
        .gte('posted_at', prev.start.toISO()).lte('posted_at', range.end.toISO()),
      supabase.from('analytics_snapshots').select('account_id, follower_count, captured_at').is('post_id', null).in('account_id', ids)
        .not('follower_count', 'is', null).lte('captured_at', range.end.toISO()).order('captured_at'),
      supabase.from('content_campaigns').select('*'),
      platforms.length
        ? supabase.from('leads').select('id, classification, is_disqualified, current_stage, source, created_at')
          .or(platforms.map(p => `source.ilike.%${p}%`).join(','))
          .gte('created_at', range.start.toISO()).lte('created_at', range.end.toISO())
        : Promise.resolve({ data: [] }),
    ])
    setData({ snaps: snapRes.data || [], posts: postsRes.data || [], followers: followersRes.data || [], campaigns: campaignsRes.data || [], leads: leadsRes.data || [] })
    setBest(await fetchBestTimes(visibleAccounts))
    setLoading(false)
  }

  const inRange = (iso, r) => { const d = DateTime.fromISO(iso); return d >= r.start && d <= r.end }

  const summary = useMemo(() => {
    if (!data) return null
    const sum = (rows, k) => rows.reduce((t, r) => t + num(r[k]), 0)
    const block = r => {
      const rows = data.snaps.filter(s => inRange(s.captured_at, r))
      const impressions = sum(rows, 'impressions')
      const engagement = rows.reduce((t, s) => t + engagementOf(s), 0)
      return {
        impressions, engagement, reach: sum(rows, 'reach'), clicks: sum(rows, 'clicks'), reactions: sum(rows, 'reactions'),
        comments: sum(rows, 'comments'), shares: sum(rows, 'shares'), videoViews: sum(rows, 'video_views'),
        rate: impressions ? (engagement / impressions) * 100 : 0,
        posts: data.posts.filter(p => inRange(p.posted_at, r)).length,
      }
    }
    // Followers: latest per account at a moment, summed.
    const followersAt = moment => {
      const latest = {}
      for (const f of data.followers) if (DateTime.fromISO(f.captured_at) <= moment) latest[f.account_id] = f.follower_count
      return Object.values(latest).reduce((t, v) => t + v, 0)
    }
    return { cur: block(range), prev: block(prev), followers: followersAt(range.end), followersStart: followersAt(range.start), hasFollowers: data.followers.length > 0 }
  }, [data, range, prev])

  const trend = useMemo(() => {
    if (!data) return { labels: [], series: [] }
    const days = Math.max(1, Math.ceil(range.end.diff(range.start, 'days').days))
    const byWeek = days > 60
    const buckets = new Map()
    for (let d = range.start.startOf(byWeek ? 'week' : 'day'); d <= range.end; d = d.plus(byWeek ? { weeks: 1 } : { days: 1 })) {
      buckets.set(d.toISODate(), { impressions: 0, engagement: 0 })
    }
    for (const s of data.snaps.filter(s => inRange(s.captured_at, range))) {
      const key = DateTime.fromISO(s.captured_at).startOf(byWeek ? 'week' : 'day').toISODate()
      const b = buckets.get(key)
      if (b) { b.impressions += num(s.impressions); b.engagement += engagementOf(s) }
    }
    const keys = [...buckets.keys()]
    return {
      labels: keys.map(k => DateTime.fromISO(k).toFormat('d LLL')),
      series: [
        { label: 'Impressions', values: keys.map(k => buckets.get(k).impressions), color: '#EC3013' },
        { label: 'Engagements', values: keys.map(k => buckets.get(k).engagement), color: '#1d4ed8' },
      ],
    }
  }, [data, range])

  const periodPosts = useMemo(() => {
    if (!data) return []
    return data.posts.filter(p => inRange(p.posted_at, range)).map(p => {
      const s = p.last_stats || {}
      const engagement = engagementOf(s)
      return { ...p, impressions: num(s.impressions), engagement, clicks: num(s.clicks), comments: num(s.comments), rate: num(s.impressions) ? (engagement / num(s.impressions)) * 100 : 0 }
    })
  }, [data, range])

  const topPosts = useMemo(() => [...periodPosts].sort((a, b) => b[sortBy] - a[sortBy]).slice(0, 10), [periodPosts, sortBy])

  const breakdownRows = useMemo(() => {
    const keyOf = {
      format: p => POST_TYPE_LABELS[p.post_type] || p.post_type,
      pillar: p => p.content_pillars?.name || 'No pillar',
      campaign: p => p.content_campaigns?.name || 'No campaign',
      weekday: p => WEEKDAYS[DateTime.fromISO(p.posted_at).weekday],
      account: p => accountById[p.account_id]?.account_name || 'Unknown',
    }[breakdown]
    const map = new Map()
    for (const p of periodPosts) {
      const k = keyOf(p)
      const r = map.get(k) || { name: k, posts: 0, impressions: 0, engagement: 0, clicks: 0 }
      r.posts++; r.impressions += p.impressions; r.engagement += p.engagement; r.clicks += p.clicks
      map.set(k, r)
    }
    return [...map.values()].map(r => ({ ...r, rate: r.impressions ? (r.engagement / r.impressions) * 100 : 0 }))
      .sort((a, b) => b.engagement - a.engagement)
  }, [periodPosts, breakdown, accountById])

  const attribution = useMemo(() => {
    const leads = data?.leads || []
    return { total: leads.length, qualified: leads.filter(isQualified).length }
  }, [data])

  const goals = useMemo(() => {
    if (!data) return []
    const today = DateTime.now().toISODate()
    return data.campaigns.filter(c => c.target_metric && c.target_value && (!c.end_date || c.end_date >= today)).map(c => {
      const posts = periodPosts.filter(p => p.campaign_id === c.id)
      const imp = posts.reduce((t, p) => t + p.impressions, 0)
      const eng = posts.reduce((t, p) => t + p.engagement, 0)
      const actual = {
        impressions: imp,
        engagement_rate: imp ? Number(((eng / imp) * 100).toFixed(2)) : 0,
        website_traffic: posts.reduce((t, p) => t + p.clicks, 0),
        follower_growth: summary ? summary.followers - summary.followersStart : 0,
      }[c.target_metric] || 0
      return { ...c, actual, pct: Math.min(100, (actual / Number(c.target_value)) * 100) }
    })
  }, [data, periodPosts, summary, attribution])

  async function openDrill(p) {
    const { data: snaps } = await supabase.from('analytics_snapshots').select('*').eq('post_id', p.id).order('captured_at')
    setDrill({ post: p, snaps: snaps || [] })
  }

  // ── Manual entry & CSV import ──
  async function saveLog() {
    const f = log.fields
    const accountId = log.post_id
      ? periodPosts.find(p => p.id === log.post_id)?.account_id || null
      : (log.account_id || visibleAccounts[0]?.id || null)
    const { error } = await supabase.from('analytics_snapshots').insert({
      account_id: accountId, post_id: log.post_id || null, captured_at: new Date(log.date).toISOString(), source: 'manual',
      impressions: num(f.impressions), reach: num(f.reach), reactions: num(f.reactions), comments: num(f.comments),
      shares: num(f.shares), clicks: num(f.clicks), video_views: num(f.video_views),
      follower_count: f.follower_count ? num(f.follower_count) : null,
    })
    if (error) { showToast('error', 'Failed to save'); return }
    setShowLog(false)
    setLog(l => ({ ...l, post_id: '', fields: emptyMetrics() }))
    showToast('success', 'Metrics logged')
    load()
  }

  async function importCsv(e) {
    const file = e.target.files?.[0]
    if (csvRef.current) csvRef.current.value = ''
    if (!file) return
    if (visibleAccounts.length !== 1) { showToast('error', 'Select exactly one account in the account bar — an export covers one page'); return }
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
    const payload = rows.map(r => {
      const n = {}
      Object.entries(r).forEach(([k, v]) => { n[String(k).trim().toLowerCase().replace(/\s+/g, '_')] = v })
      const d = n.date ? new Date(n.date) : null
      return {
        account_id: visibleAccounts[0].id, post_id: null, source: 'csv_import',
        captured_at: d && !isNaN(d.getTime()) ? d.toISOString() : new Date().toISOString(),
        impressions: num(n.impressions), reach: num(n.reach), reactions: num(n.reactions), comments: num(n.comments),
        shares: num(n.shares), clicks: num(n.clicks), video_views: num(n.video_views), follower_count: n.follower_count ? num(n.follower_count) : null,
      }
    })
    if (!payload.length) { showToast('error', 'No rows found in the file'); return }
    const { error } = await supabase.from('analytics_snapshots').insert(payload)
    if (error) { showToast('error', 'Import failed'); return }
    showToast('success', `Imported ${payload.length} row(s) into ${visibleAccounts[0].account_name}`)
    load()
  }

  const periodLabel = `${range.start.toFormat('d LLL yyyy')} – ${range.end.toFormat('d LLL yyyy')}`

  function exportCsvFile() {
    if (!summary) return
    const c = summary.cur
    exportCSV(['Metric', 'This period', 'Previous period'], [
      ['Period', periodLabel, `${prev.start.toFormat('d LLL yyyy')} – ${prev.end.toFormat('d LLL yyyy')}`],
      ['Accounts', visibleAccounts.map(a => a.account_name).join('; '), ''],
      ['Impressions', c.impressions, summary.prev.impressions],
      ['Engagements', c.engagement, summary.prev.engagement],
      ['Engagement rate %', c.rate.toFixed(2), summary.prev.rate.toFixed(2)],
      ['Clicks', c.clicks, summary.prev.clicks],
      ['Posts published', c.posts, summary.prev.posts],
      ['Followers', summary.followers, summary.followersStart],
      [],
      ['Post', 'Posted', 'Impressions', 'Engagements', 'Rate %', 'Clicks', 'URL'],
      ...periodPosts.map(p => [p.caption?.slice(0, 80) || '', DateTime.fromISO(p.posted_at).toISODate(), p.impressions, p.engagement, p.rate.toFixed(2), p.clicks, p.external_post_url || '']),
    ], `SDFM_Social_Analytics_${DateTime.now().toISODate()}`)
  }

  function exportPdfFile() {
    if (!summary) return
    const c = summary.cur
    const m = new Map()
    for (const p of periodPosts) {
      const k = p.content_pillars?.name || 'No pillar'
      const r = m.get(k) || { name: k, posts: 0, impressions: 0, engagement: 0 }
      r.posts++; r.impressions += p.impressions; r.engagement += p.engagement
      m.set(k, r)
    }
    exportSocialAnalyticsPDF({
      title: `Social Media Report — ${visibleAccounts.map(a => a.account_name).join(', ')}`.slice(0, 90),
      periodLabel,
      totalImpressions: c.impressions, totalReach: c.reach, avgEngagementRate: c.rate.toFixed(2),
      totalReactions: c.reactions, totalComments: c.comments, totalShares: c.shares, totalClicks: c.clicks,
      totalVideoViews: c.videoViews, followerGrowth: summary.followers - summary.followersStart,
      pillarRollup: [...m.values()],
      leadsFromLinkedIn: attribution.total, qualifiedFromLinkedIn: attribution.qualified,
    }, `SDFM_Social_Report_${DateTime.now().toISODate()}`)
  }

  return (
    <div className="analytics-page">
      <SocialHeader title="Analytics" subtitle={`${periodLabel} · compared with the ${Math.max(1, Math.round(range.end.diff(range.start, 'days').days))} days before`}>
        <select className="form-input form-input-sm" style={{ width: 'auto' }} value={rangeKey} onChange={e => pickRange(e.target.value)}>
          {RANGES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
        {rangeKey === 'custom' && (
          <>
            <input type="date" className="form-input form-input-sm" style={{ width: 'auto' }} value={custom.start} onChange={e => setCustom(c => ({ ...c, start: e.target.value }))} />
            <input type="date" className="form-input form-input-sm" style={{ width: 'auto' }} value={custom.end} onChange={e => setCustom(c => ({ ...c, end: e.target.value }))} />
          </>
        )}
        <input ref={csvRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} onChange={importCsv} />
        <button className="btn btn-secondary btn-sm" onClick={() => csvRef.current?.click()}>Import CSV</button>
        <button className="btn btn-secondary btn-sm" onClick={() => setShowLog(true)}>Log metrics</button>
        <button className="btn btn-secondary btn-sm" onClick={exportCsvFile}>CSV</button>
        <button className="btn btn-primary btn-sm" onClick={exportPdfFile}>PDF report</button>
      </SocialHeader>

      <AccountBar accounts={accounts} selected={selected} onChange={setSelected} />

      {loading || !summary ? (
        <div className="sm-stats">{[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="skeleton skeleton-card" style={{ height: 96 }} />)}</div>
      ) : (
        <>
          <div className="sm-stats">
            <StatTile label="Followers" value={summary.followers} hint={summary.hasFollowers ? `${summary.followers - summary.followersStart >= 0 ? '+' : ''}${(summary.followers - summary.followersStart).toLocaleString()} in this period` : 'Synced for Company Pages'} />
            <StatTile label="Impressions" value={summary.cur.impressions} previous={summary.prev.impressions} />
            <StatTile label="Engagements" value={summary.cur.engagement} previous={summary.prev.engagement} hint="Reactions + comments + shares" />
            <StatTile label="Engagement rate" value={summary.cur.rate} previous={summary.prev.rate} format={v => `${v.toFixed(2)}%`} />
            <StatTile label="Clicks" value={summary.cur.clicks} previous={summary.prev.clicks} />
            <StatTile label="Posts published" value={summary.cur.posts} previous={summary.prev.posts} />
          </div>

          <div className="section-card">
            <div className="section-card-header">
              <h2 className="section-card-title">Impressions &amp; engagements</h2>
              <div className="sa-legend"><span style={{ background: '#EC3013' }} />Impressions <span style={{ background: '#1d4ed8' }} />Engagements</div>
            </div>
            <TrendChart labels={trend.labels} series={trend.series} />
          </div>

          <div className="sm-grid-2">
            <div className="section-card">
              <div className="section-card-header"><h2 className="section-card-title">Best times to post</h2></div>
              <Heatmap cells={best.cells} valueLabel={v => best.isDefault ? 'recommended' : `${v.toFixed(1)}% avg. engagement`}
                emptyNote={best.isDefault
                  ? `Industry best times for your networks. Your own pattern replaces this after ${MIN_POSTS} published posts (${best.sample} so far).`
                  : `From ${best.sample} published posts: darker = higher average engagement rate.`} />
            </div>
            <div className="section-card">
              <div className="section-card-header"><h2 className="section-card-title">Pipeline attribution</h2></div>
              <p className="composer-hint">Leads in this period whose source mentions {[...new Set(visibleAccounts.map(a => platformOf(a).name))].join(' or ') || 'a social network'}.</p>
              <div className="sa-attribution-grid">
                <div><span className="sa-attr-value">{attribution.total}</span><span className="sa-attr-label">Leads</span></div>
                <div><span className="sa-attr-value">{attribution.qualified}</span><span className="sa-attr-label">Qualified</span></div>
              </div>
              {goals.length > 0 && (
                <div className="sa-goals">
                  <h3>Campaign goals</h3>
                  {goals.map(g => (
                    <div key={g.id} className="sa-goal">
                      <div className="sa-goal-head"><span>{g.name}</span><span>{g.actual.toLocaleString()} / {Number(g.target_value).toLocaleString()}</span></div>
                      <div className="sa-goal-bar"><div style={{ width: `${g.pct}%` }} /></div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="section-card">
            <div className="section-card-header">
              <h2 className="section-card-title">Top posts</h2>
              <div className="sm-tabs">{Object.entries(SORTS).map(([k, l]) => <button key={k} className={`sm-tab ${sortBy === k ? 'active' : ''}`} onClick={() => setSortBy(k)}>{l}</button>)}</div>
            </div>
            {topPosts.length === 0 ? <EmptyState title="No published posts in this period">Stats appear within a few hours of publishing.</EmptyState> : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th>Post</th><th>Account</th><th>Published</th><th>Impressions</th><th>Engagements</th><th>Rate</th><th>Clicks</th><th></th></tr></thead>
                  <tbody>
                    {topPosts.map(p => (
                      <tr key={p.id} className="sa-row" onClick={() => openDrill(p)}>
                        <td className="sa-post-cell">{(p.caption || '(no caption)').slice(0, 80)}<small>{POST_TYPE_LABELS[p.post_type]}</small></td>
                        <td>{accountById[p.account_id] && <AccountAvatar account={accountById[p.account_id]} size={22} />}</td>
                        <td>{DateTime.fromISO(p.posted_at).toFormat('d LLL, HH:mm')}</td>
                        <td>{p.impressions.toLocaleString()}</td>
                        <td>{p.engagement.toLocaleString()}</td>
                        <td>{p.rate.toFixed(2)}%</td>
                        <td>{p.clicks.toLocaleString()}</td>
                        <td>{p.external_post_url && <a href={p.external_post_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>View</a>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="section-card">
            <div className="section-card-header">
              <h2 className="section-card-title">What performs</h2>
              <div className="sm-tabs">
                {[['format', 'Format'], ['pillar', 'Pillar'], ['campaign', 'Campaign'], ['weekday', 'Weekday'], ['account', 'Account']].map(([k, l]) => (
                  <button key={k} className={`sm-tab ${breakdown === k ? 'active' : ''}`} onClick={() => setBreakdown(k)}>{l}</button>
                ))}
              </div>
            </div>
            {breakdownRows.length === 0 ? <EmptyState title="No data yet" /> : (
              <div className="sa-bars">
                {breakdownRows.map(r => {
                  const max = Math.max(...breakdownRows.map(x => x.engagement), 1)
                  return (
                    <div key={r.name} className="sa-bar-row">
                      <span className="sa-bar-name">{r.name}</span>
                      <span className="sa-bar-track"><span style={{ width: `${(r.engagement / max) * 100}%` }} /></span>
                      <span className="sa-bar-stats">{r.posts} post{r.posts === 1 ? '' : 's'} · {r.engagement.toLocaleString()} eng. · {r.rate.toFixed(2)}% · {r.impressions.toLocaleString()} impr.</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}

      {drill && (
        <div className="modal-overlay" onClick={() => setDrill(null)}>
          <div className="modal-card modal-card-wide" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Post performance</h3>
            <p className="modal-subtitle">{(drill.post.caption || '').slice(0, 200)}</p>
            <div className="sm-stats">
              <StatTile label="Impressions" value={drill.post.impressions} />
              <StatTile label="Engagements" value={drill.post.engagement} />
              <StatTile label="Rate" value={drill.post.rate} format={v => `${v.toFixed(2)}%`} />
              <StatTile label="Clicks" value={drill.post.clicks} />
            </div>
            {drill.snaps.length > 1 && (
              <TrendChart labels={drill.snaps.map(s => DateTime.fromISO(s.captured_at).toFormat('d LLL'))}
                series={[{ label: 'Impressions', values: drill.snaps.reduce((acc, s) => [...acc, (acc.at(-1) || 0) + num(s.impressions)], []), color: '#EC3013' }]} />
            )}
            <div className="modal-actions">
              {drill.post.external_post_url && <a className="btn btn-secondary" href={drill.post.external_post_url} target="_blank" rel="noopener noreferrer">Open post</a>}
              <button className="btn btn-primary" onClick={() => setDrill(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {showLog && (
        <div className="modal-overlay" onClick={() => setShowLog(false)}>
          <div className="modal-card modal-card-wide" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Log metrics</h3>
            <p className="modal-subtitle">For accounts or numbers the BMS can't sync. Enter the change for that day (not running totals), except followers.</p>
            <div className="composer-two-col">
              <div className="form-group"><label className="form-label">Date</label><input type="date" className="form-input" value={log.date} onChange={e => setLog(l => ({ ...l, date: e.target.value }))} /></div>
              <div className="form-group">
                <label className="form-label">For</label>
                <select className="form-input" value={log.post_id || `acc:${log.account_id || visibleAccounts[0]?.id || ''}`}
                  onChange={e => e.target.value.startsWith('acc:') ? setLog(l => ({ ...l, account_id: e.target.value.slice(4), post_id: '' })) : setLog(l => ({ ...l, post_id: e.target.value }))}>
                  {visibleAccounts.map(a => <option key={a.id} value={`acc:${a.id}`}>Whole account · {a.account_name}</option>)}
                  {periodPosts.map(p => <option key={p.id} value={p.id}>Post · {(p.caption || '').slice(0, 40)}</option>)}
                </select>
              </div>
            </div>
            <div className="sa-log-grid">
              {Object.keys(emptyMetrics()).map(k => (
                <div key={k} className="form-group">
                  <label className="form-label">{k.replace('_', ' ')}</label>
                  <input type="number" min="0" className="form-input" value={log.fields[k]} onChange={e => setLog(l => ({ ...l, fields: { ...l.fields, [k]: e.target.value } }))} />
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowLog(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveLog}>Save</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className={`toast toast-${toast.type}`}>{toast.text}</div>}
    </div>
  )
}
