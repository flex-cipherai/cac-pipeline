import { useState, useEffect, useMemo, useRef } from 'react'
import * as XLSX from 'xlsx'
import { DateTime } from 'luxon'
import { supabase } from '../../lib/supabase'
import { exportCSV, exportSocialAnalyticsPDF } from '../../lib/exportUtils'
import PeriodSelector, { filterByPeriod, getPeriodLabel } from '../../components/PeriodSelector/PeriodSelector'
import '../Dashboard.css'
import '../MarketingAnalytics.css'
import './ContentLibrary.css'
import './SocialAnalytics.css'

const METRIC_FIELDS = [
  { key: 'impressions', label: 'Impressions' },
  { key: 'reach', label: 'Reach' },
  { key: 'reactions', label: 'Reactions' },
  { key: 'comments', label: 'Comments' },
  { key: 'shares', label: 'Shares' },
  { key: 'clicks', label: 'Clicks' },
  { key: 'video_views', label: 'Video Views' },
  { key: 'follower_count', label: 'Follower Count (running total)' },
]

const GOAL_LABELS = {
  impressions: 'Impressions',
  follower_growth: 'Follower Growth',
  engagement_rate: 'Engagement Rate',
  website_traffic: 'Website Traffic (clicks)',
  discovery_calls: 'Discovery Call Bookings',
}

function emptyMetrics() {
  return { impressions: '', reach: '', reactions: '', comments: '', shares: '', clicks: '', video_views: '', follower_count: '' }
}

export default function SocialAnalytics() {
  const now = new Date()
  const [period, setPeriod] = useState({ mode: 'all', month: now.getMonth(), year: now.getFullYear() })
  const [loading, setLoading] = useState(true)

  const [accountSnapshots, setAccountSnapshots] = useState([])
  const [postSnapshots, setPostSnapshots] = useState([])
  const [campaigns, setCampaigns] = useState([])
  const [linkedInLeads, setLinkedInLeads] = useState([])
  const [posts, setPosts] = useState([])

  const [showLogModal, setShowLogModal] = useState(false)
  const [logForPostId, setLogForPostId] = useState('')
  const [logDate, setLogDate] = useState(new Date().toISOString().slice(0, 10))
  const [logFields, setLogFields] = useState(emptyMetrics())
  const [saving, setSaving] = useState(false)

  const [drillDownPost, setDrillDownPost] = useState(null)
  const [drillDownSnapshots, setDrillDownSnapshots] = useState([])

  const csvInputRef = useRef(null)
  const [toast, setToast] = useState({ show: false, type: '', text: '' })

  useEffect(() => { fetchAll() }, [])

  useEffect(() => {
    if (toast.show) {
      const t = setTimeout(() => setToast({ show: false, type: '', text: '' }), 4000)
      return () => clearTimeout(t)
    }
  }, [toast.show])

  function showToast(type, text) { setToast({ show: true, type, text }) }

  async function fetchAll() {
    setLoading(true)
    const [accSnap, postSnap, campaignsRes, leadsRes, postsRes] = await Promise.all([
      supabase.from('analytics_snapshots').select('*').is('post_id', null).order('captured_at'),
      supabase.from('analytics_snapshots').select('*, posts(id, caption, post_type, pillar_id, campaign_id, status, content_pillars(name), content_campaigns(name))').not('post_id', 'is', null).order('captured_at'),
      supabase.from('content_campaigns').select('*'),
      supabase.from('leads').select('id, classification, is_disqualified, scheduled_date, source').ilike('source', '%linkedin%'),
      supabase.from('posts').select('id, caption, status').eq('status', 'posted'),
    ])
    if (accSnap.data) setAccountSnapshots(accSnap.data)
    if (postSnap.data) setPostSnapshots(postSnap.data)
    if (campaignsRes.data) setCampaigns(campaignsRes.data)
    if (leadsRes.data) setLinkedInLeads(leadsRes.data)
    if (postsRes.data) setPosts(postsRes.data)
    setLoading(false)
  }

  const filteredAccountSnapshots = useMemo(() => filterByPeriod(accountSnapshots, period, 'captured_at'), [accountSnapshots, period])
  const filteredPostSnapshots = useMemo(() => filterByPeriod(postSnapshots, period, 'captured_at'), [postSnapshots, period])

  const totals = useMemo(() => {
    const sum = (arr, key) => arr.reduce((s, r) => s + (Number(r[key]) || 0), 0)
    const totalImpressions = sum(filteredAccountSnapshots, 'impressions')
    const totalReach = sum(filteredAccountSnapshots, 'reach')
    const totalReactions = sum(filteredAccountSnapshots, 'reactions')
    const totalComments = sum(filteredAccountSnapshots, 'comments')
    const totalShares = sum(filteredAccountSnapshots, 'shares')
    const totalClicks = sum(filteredAccountSnapshots, 'clicks')
    const totalVideoViews = sum(filteredAccountSnapshots, 'video_views')
    const avgEngagementRate = totalImpressions > 0
      ? (((totalReactions + totalComments + totalShares) / totalImpressions) * 100).toFixed(2)
      : '0.00'

    const withFollowers = [...filteredAccountSnapshots].filter(s => s.follower_count != null).sort((a, b) => new Date(a.captured_at) - new Date(b.captured_at))
    const followerGrowth = withFollowers.length >= 2 ? withFollowers[withFollowers.length - 1].follower_count - withFollowers[0].follower_count : 0
    const currentFollowers = withFollowers.length > 0 ? withFollowers[withFollowers.length - 1].follower_count : null

    return { totalImpressions, totalReach, totalReactions, totalComments, totalShares, totalClicks, totalVideoViews, avgEngagementRate, followerGrowth, currentFollowers }
  }, [filteredAccountSnapshots])

  const trend = useMemo(() => {
    const byDate = {}
    filteredAccountSnapshots.forEach(s => {
      const d = DateTime.fromISO(s.captured_at).toFormat('d LLL')
      if (!byDate[d]) byDate[d] = 0
      byDate[d] += Number(s.impressions) || 0
    })
    const entries = Object.entries(byDate).slice(-8)
    const max = Math.max(...entries.map(([, v]) => v), 1)
    return { entries, max }
  }, [filteredAccountSnapshots])

  function rollupBy(getKey) {
    const map = new Map()
    filteredPostSnapshots.forEach(s => {
      const key = getKey(s.posts)
      if (!key) return
      if (!map.has(key)) map.set(key, { name: key, posts: new Set(), impressions: 0, engagement: 0 })
      const entry = map.get(key)
      entry.posts.add(s.post_id)
      entry.impressions += Number(s.impressions) || 0
      entry.engagement += (Number(s.reactions) || 0) + (Number(s.comments) || 0) + (Number(s.shares) || 0)
    })
    return Array.from(map.values()).map(e => ({ name: e.name, posts: e.posts.size, impressions: e.impressions, engagement: e.engagement })).sort((a, b) => b.impressions - a.impressions)
  }

  const pillarRollup = useMemo(() => rollupBy(p => p?.content_pillars?.name || 'Uncategorized'), [filteredPostSnapshots])
  const campaignRollup = useMemo(() => rollupBy(p => p?.content_campaigns?.name || null), [filteredPostSnapshots])
  const formatRollup = useMemo(() => rollupBy(p => p?.post_type), [filteredPostSnapshots])

  const postDrillDown = useMemo(() => {
    const map = new Map()
    postSnapshots.forEach(s => {
      if (!s.posts) return
      if (!map.has(s.post_id)) map.set(s.post_id, { post: s.posts, impressions: 0, engagement: 0 })
      const e = map.get(s.post_id)
      e.impressions += Number(s.impressions) || 0
      e.engagement += (Number(s.reactions) || 0) + (Number(s.comments) || 0) + (Number(s.shares) || 0)
    })
    return Array.from(map.values()).sort((a, b) => b.impressions - a.impressions)
  }, [postSnapshots])

  const pipelineAttribution = useMemo(() => {
    const total = linkedInLeads.length
    const qualified = linkedInLeads.filter(l => l.classification !== 'cold' && !l.is_disqualified).length
    const calls = linkedInLeads.filter(l => l.scheduled_date).length
    return { total, qualified, calls }
  }, [linkedInLeads])

  function goalActual(campaign) {
    const relevant = filteredPostSnapshots.filter(s => s.posts?.campaign_id === campaign.id)
    switch (campaign.target_metric) {
      case 'impressions': return relevant.reduce((s, r) => s + (Number(r.impressions) || 0), 0)
      case 'engagement_rate': {
        const impr = relevant.reduce((s, r) => s + (Number(r.impressions) || 0), 0)
        const eng = relevant.reduce((s, r) => s + (Number(r.reactions) || 0) + (Number(r.comments) || 0) + (Number(r.shares) || 0), 0)
        return impr > 0 ? Number(((eng / impr) * 100).toFixed(2)) : 0
      }
      case 'website_traffic': return relevant.reduce((s, r) => s + (Number(r.clicks) || 0), 0)
      case 'follower_growth': return totals.followerGrowth
      case 'discovery_calls': return pipelineAttribution.calls
      default: return 0
    }
  }

  // ── Manual entry ──
  async function handleSaveLog() {
    setSaving(true)
    const payload = {
      account_id: null,
      post_id: logForPostId || null,
      captured_at: new Date(logDate).toISOString(),
      source: 'manual',
      impressions: Number(logFields.impressions) || 0,
      reach: Number(logFields.reach) || 0,
      reactions: Number(logFields.reactions) || 0,
      comments: Number(logFields.comments) || 0,
      shares: Number(logFields.shares) || 0,
      clicks: Number(logFields.clicks) || 0,
      video_views: Number(logFields.video_views) || 0,
      follower_count: logFields.follower_count ? Number(logFields.follower_count) : null,
    }
    // Fetch account id for account-level logs
    if (!payload.post_id) {
      const { data: account } = await supabase.from('connected_accounts').select('id').eq('platform', 'linkedin').maybeSingle()
      payload.account_id = account?.id || null
    }
    const { error } = await supabase.from('analytics_snapshots').insert(payload)
    setSaving(false)
    if (error) { showToast('error', 'Failed to save'); return }
    showToast('success', 'Analytics logged')
    setShowLogModal(false)
    setLogFields(emptyMetrics())
    setLogForPostId('')
    fetchAll()
  }

  async function handleCsvImport(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: 'array' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })

    const { data: account } = await supabase.from('connected_accounts').select('id').eq('platform', 'linkedin').maybeSingle()

    const payload = rows.map(r => {
      const norm = {}
      Object.entries(r).forEach(([k, v]) => { norm[String(k).trim().toLowerCase().replace(/\s+/g, '_')] = v })
      const date = norm.date ? new Date(norm.date) : null
      return {
        account_id: account?.id || null,
        post_id: null,
        captured_at: date && !isNaN(date.getTime()) ? date.toISOString() : new Date().toISOString(),
        source: 'csv_import',
        impressions: Number(norm.impressions) || 0,
        reach: Number(norm.reach) || 0,
        reactions: Number(norm.reactions) || 0,
        comments: Number(norm.comments) || 0,
        shares: Number(norm.shares) || 0,
        clicks: Number(norm.clicks) || 0,
        video_views: Number(norm.video_views) || 0,
        follower_count: norm.follower_count ? Number(norm.follower_count) : null,
      }
    })

    if (payload.length === 0) { showToast('error', 'No rows found in file'); return }
    const { error } = await supabase.from('analytics_snapshots').insert(payload)
    if (csvInputRef.current) csvInputRef.current.value = ''
    if (error) { showToast('error', 'Import failed'); return }
    showToast('success', `Imported ${payload.length} row(s)`)
    fetchAll()
  }

  async function openDrillDown(entry) {
    setDrillDownPost(entry.post)
    const { data } = await supabase.from('analytics_snapshots').select('*').eq('post_id', entry.post.id).order('captured_at')
    setDrillDownSnapshots(data || [])
  }

  function handleExportCSV() {
    const headers = ['Metric', 'Value']
    const rows = [
      ['Period', getPeriodLabel(period)],
      ['Impressions', String(totals.totalImpressions)],
      ['Reach', String(totals.totalReach)],
      ['Engagement Rate', `${totals.avgEngagementRate}%`],
      ['Reactions', String(totals.totalReactions)],
      ['Comments', String(totals.totalComments)],
      ['Shares', String(totals.totalShares)],
      ['Clicks', String(totals.totalClicks)],
      ['Video Views', String(totals.totalVideoViews)],
      ['Follower Growth', String(totals.followerGrowth)],
      [''],
      ['Pillar', 'Posts', 'Impressions', 'Engagement'],
      ...pillarRollup.map(r => [r.name, String(r.posts), String(r.impressions), String(r.engagement)]),
    ]
    exportCSV(headers, rows, `SDFM_LinkedIn_Analytics_${new Date().toISOString().slice(0, 10)}`)
  }

  function handleExportPDF() {
    exportSocialAnalyticsPDF({
      periodLabel: getPeriodLabel(period),
      totalImpressions: totals.totalImpressions,
      totalReach: totals.totalReach,
      avgEngagementRate: totals.avgEngagementRate,
      totalReactions: totals.totalReactions,
      totalComments: totals.totalComments,
      totalShares: totals.totalShares,
      totalClicks: totals.totalClicks,
      totalVideoViews: totals.totalVideoViews,
      followerGrowth: totals.followerGrowth,
      pillarRollup,
      leadsFromLinkedIn: pipelineAttribution.total,
      qualifiedFromLinkedIn: pipelineAttribution.qualified,
      discoveryCallsFromLinkedIn: pipelineAttribution.calls,
    }, `SDFM_LinkedIn_Analytics_${new Date().toISOString().slice(0, 10)}`)
  }

  if (loading) {
    return (
      <div>
        <div className="page-header"><h1 className="page-title">LinkedIn Analytics</h1></div>
        <div className="dash-stats-row">{[1, 2, 3, 4].map(i => <div key={i} className="skeleton skeleton-card" />)}</div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header dash-header">
        <div>
          <h1 className="page-title">LinkedIn Analytics</h1>
          <p className="page-subtitle">Assisted Mode · metrics logged manually or imported from LinkedIn's CSV export</p>
        </div>
        <div className="dash-header-actions">
          <PeriodSelector value={period} onChange={setPeriod} />
          <input ref={csvInputRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} onChange={handleCsvImport} />
          <button className="btn btn-secondary btn-sm" onClick={() => csvInputRef.current?.click()}>Import CSV</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowLogModal(true)}>Log Metrics</button>
          <button className="btn btn-secondary btn-sm" onClick={handleExportCSV}>CSV</button>
          <button className="btn btn-secondary btn-sm" onClick={handleExportPDF}>PDF</button>
        </div>
      </div>

      {/* ── Top stats ── */}
      <div className="dash-stats-row">
        <div className="stat-card"><div className="stat-label">Impressions</div><div className="stat-value">{totals.totalImpressions.toLocaleString()}</div></div>
        <div className="stat-card"><div className="stat-label">Reach</div><div className="stat-value">{totals.totalReach.toLocaleString()}</div></div>
        <div className="stat-card"><div className="stat-label">Engagement Rate</div><div className="stat-value">{totals.avgEngagementRate}%</div></div>
        <div className="stat-card"><div className="stat-label">Follower Growth</div><div className="stat-value">{totals.followerGrowth >= 0 ? '+' : ''}{totals.followerGrowth}</div></div>
      </div>
      <div className="dash-stats-row">
        <div className="stat-card"><div className="stat-label">Reactions</div><div className="stat-value">{totals.totalReactions.toLocaleString()}</div></div>
        <div className="stat-card"><div className="stat-label">Comments</div><div className="stat-value">{totals.totalComments.toLocaleString()}</div></div>
        <div className="stat-card"><div className="stat-label">Shares</div><div className="stat-value">{totals.totalShares.toLocaleString()}</div></div>
        <div className="stat-card"><div className="stat-label">Link Clicks</div><div className="stat-value">{totals.totalClicks.toLocaleString()}</div></div>
      </div>

      {/* ── Trend + Pipeline Attribution ── */}
      <div className="dash-grid-2">
        <div className="section-card">
          <div className="section-card-header"><h2 className="section-card-title">Impressions Trend</h2></div>
          {trend.entries.length === 0 ? (
            <div className="empty-state"><p className="empty-state-desc">No metrics logged for this period yet.</p></div>
          ) : (
            <div className="mkt-bar-chart">
              {trend.entries.map(([label, value]) => (
                <div className="mkt-bar-col" key={label}>
                  <div className="mkt-bar-track"><div className="mkt-bar-fill mkt-bar-total" style={{ height: `${(value / trend.max) * 100}%` }} /></div>
                  <span className="mkt-bar-label">{label}</span>
                  <span className="mkt-bar-value">{value}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="section-card">
          <div className="section-card-header"><h2 className="section-card-title">Pipeline Attribution</h2></div>
          <p className="composer-hint" style={{ marginBottom: 'var(--space-md)' }}>Leads whose source is LinkedIn, from the Sales Pipeline.</p>
          <div className="sa-attribution-grid">
            <div><span className="sa-attr-value">{pipelineAttribution.total}</span><span className="sa-attr-label">Leads Sourced</span></div>
            <div><span className="sa-attr-value">{pipelineAttribution.qualified}</span><span className="sa-attr-label">Qualified</span></div>
            <div><span className="sa-attr-value">{pipelineAttribution.calls}</span><span className="sa-attr-label">Calls Booked</span></div>
          </div>
        </div>
      </div>

      {/* ── Roll-ups ── */}
      <div className="section-card">
        <div className="section-card-header"><h2 className="section-card-title">Performance by Content Pillar</h2></div>
        {pillarRollup.length === 0 ? (
          <div className="empty-state"><p className="empty-state-desc">No post-level metrics logged yet.</p></div>
        ) : (
          <table className="data-table">
            <thead><tr><th>Pillar</th><th>Posts</th><th>Impressions</th><th>Engagement</th></tr></thead>
            <tbody>{pillarRollup.map(r => <tr key={r.name}><td>{r.name}</td><td>{r.posts}</td><td>{r.impressions.toLocaleString()}</td><td>{r.engagement.toLocaleString()}</td></tr>)}</tbody>
          </table>
        )}
      </div>

      <div className="dash-grid-2">
        <div className="section-card">
          <div className="section-card-header"><h2 className="section-card-title">By Campaign</h2></div>
          {campaignRollup.length === 0 ? <div className="empty-state"><p className="empty-state-desc">No campaign data yet.</p></div> : (
            <table className="data-table">
              <thead><tr><th>Campaign</th><th>Posts</th><th>Impressions</th></tr></thead>
              <tbody>{campaignRollup.map(r => <tr key={r.name}><td>{r.name}</td><td>{r.posts}</td><td>{r.impressions.toLocaleString()}</td></tr>)}</tbody>
            </table>
          )}
        </div>
        <div className="section-card">
          <div className="section-card-header"><h2 className="section-card-title">By Format</h2></div>
          {formatRollup.length === 0 ? <div className="empty-state"><p className="empty-state-desc">No format data yet.</p></div> : (
            <table className="data-table">
              <thead><tr><th>Format</th><th>Posts</th><th>Impressions</th></tr></thead>
              <tbody>{formatRollup.map(r => <tr key={r.name}><td style={{ textTransform: 'capitalize' }}>{r.name}</td><td>{r.posts}</td><td>{r.impressions.toLocaleString()}</td></tr>)}</tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Goal Tracking ── */}
      {campaigns.filter(c => c.target_metric && c.target_value).length > 0 && (
        <div className="section-card">
          <div className="section-card-header"><h2 className="section-card-title">Goal Tracking</h2></div>
          <div className="sa-goals-grid">
            {campaigns.filter(c => c.target_metric && c.target_value).map(c => {
              const actual = goalActual(c)
              const pct = Math.min(100, Math.round((actual / c.target_value) * 100))
              return (
                <div key={c.id} className="sa-goal-card">
                  <div className="sa-goal-top"><span>{c.name}</span><span className="composer-hint">{GOAL_LABELS[c.target_metric]}</span></div>
                  <div className="sa-goal-track"><div className="sa-goal-fill" style={{ width: `${pct}%` }} /></div>
                  <div className="sa-goal-numbers">{actual.toLocaleString()} / {Number(c.target_value).toLocaleString()} ({pct}%)</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Post drill-down ── */}
      <div className="section-card">
        <div className="section-card-header"><h2 className="section-card-title">Post Performance</h2></div>
        {postDrillDown.length === 0 ? (
          <div className="empty-state"><p className="empty-state-desc">No post-level metrics logged yet.</p></div>
        ) : (
          <table className="data-table">
            <thead><tr><th>Post</th><th>Pillar</th><th>Impressions</th><th>Engagement</th><th></th></tr></thead>
            <tbody>
              {postDrillDown.map(e => (
                <tr key={e.post.id}>
                  <td>{(e.post.caption || '').slice(0, 60) || '(No caption)'}</td>
                  <td>{e.post.content_pillars?.name || '—'}</td>
                  <td>{e.impressions.toLocaleString()}</td>
                  <td>{e.engagement.toLocaleString()}</td>
                  <td><button className="btn btn-secondary btn-sm" onClick={() => openDrillDown(e)}>Details</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Log Metrics Modal ── */}
      {showLogModal && (
        <div className="modal-overlay" onClick={() => !saving && setShowLogModal(false)}>
          <div className="modal-card modal-card-wide" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Log LinkedIn Metrics</h3>
            <div className="composer-two-col">
              <div className="form-group">
                <label className="form-label">Date</label>
                <input type="date" className="form-input" value={logDate} onChange={e => setLogDate(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">For a specific post (optional)</label>
                <select className="form-input" value={logForPostId} onChange={e => setLogForPostId(e.target.value)}>
                  <option value="">Account-level (whole page)</option>
                  {posts.map(p => <option key={p.id} value={p.id}>{(p.caption || '').slice(0, 40) || '(No caption)'}</option>)}
                </select>
              </div>
            </div>
            <div className="sa-log-grid">
              {METRIC_FIELDS.map(f => (
                <div className="form-group" key={f.key}>
                  <label className="form-label">{f.label}</label>
                  <input type="number" min="0" className="form-input" value={logFields[f.key]} onChange={e => setLogFields(prev => ({ ...prev, [f.key]: e.target.value }))} />
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowLogModal(false)} disabled={saving}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSaveLog} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Drill-down modal ── */}
      {drillDownPost && (
        <div className="modal-overlay" onClick={() => setDrillDownPost(null)}>
          <div className="modal-card modal-card-wide" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">{(drillDownPost.caption || '').slice(0, 80) || '(No caption)'}</h3>
            {drillDownSnapshots.length === 0 ? <p className="modal-subtitle">No snapshots logged.</p> : (
              <table className="data-table">
                <thead><tr><th>Date</th><th>Impressions</th><th>Reactions</th><th>Comments</th><th>Shares</th><th>Clicks</th></tr></thead>
                <tbody>
                  {drillDownSnapshots.map(s => (
                    <tr key={s.id}>
                      <td>{DateTime.fromISO(s.captured_at).toFormat('d LLL yyyy')}</td>
                      <td>{s.impressions}</td><td>{s.reactions}</td><td>{s.comments}</td><td>{s.shares}</td><td>{s.clicks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="modal-actions"><button className="btn btn-primary" onClick={() => setDrillDownPost(null)}>Close</button></div>
          </div>
        </div>
      )}

      {toast.show && <div className={`toast toast-${toast.type}`}>{toast.text}</div>}
    </div>
  )
}
