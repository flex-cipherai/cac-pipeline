import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { PIPELINE_STAGES, estimatePipelineValue } from '../lib/scoring'
import { exportCSV, exportDashboardPDF } from '../lib/exportUtils'
import PeriodSelector, { filterByPeriod, getPeriodLabel } from '../components/PeriodSelector/PeriodSelector'
import './Dashboard.css'

const StatIcons = {
  total: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="7" cy="5.5" r="3" /><path d="M1.5 15.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5" /><circle cx="13.5" cy="6" r="2" /><path d="M13.5 10.5c2 0 3.5 1.2 3.5 3" /></svg>,
  qualified: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5.5 9.5l2.5 2.5 5-5.5" /><circle cx="9" cy="9" r="7" /></svg>,
  rate: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 14l4-5 3.5 3L16 4" /><path d="M12 4h4v4" /></svg>,
  pipeline: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="2" y="11" width="3.5" height="5" rx="0.75" /><rect x="7.25" y="7" width="3.5" height="9" rx="0.75" /><rect x="12.5" y="3" width="3.5" height="13" rx="0.75" /></svg>,
  converted: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M14 4l-8.5 8.5L2 9" /></svg>,
  value: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="9" cy="9" r="7" /><path d="M9 5v8M7 7h3.5a1.5 1.5 0 0 1 0 3H7h4a1.5 1.5 0 0 1 0 3H7" /></svg>,
  lost: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="9" cy="9" r="7" /><path d="M6 6l6 6M12 6l-6 6" /></svg>,
}

export default function Dashboard() {
  const { profile } = useAuth()
  const [allLeads, setAllLeads] = useState([])
  const [stageHistory, setStageHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const now = new Date()
  const [period, setPeriod] = useState({ mode: 'all', month: now.getMonth(), year: now.getFullYear() })

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    const [leadsRes, historyRes] = await Promise.all([
      supabase.from('leads').select('*').order('created_at', { ascending: false }),
      supabase.from('lead_stage_history').select('*, profiles:moved_by(name), leads:lead_id(full_name, company_name)').order('entered_at', { ascending: false }).limit(15),
    ])
    if (leadsRes.data) setAllLeads(leadsRes.data)
    if (historyRes.data) setStageHistory(historyRes.data)
    setLoading(false)
  }

  // Apply period filter
  const leads = filterByPeriod(allLeads, period)

  // ── Metrics ──
  const totalLeads = leads.length
  const qualifiedLeads = leads.filter(l => l.classification !== 'cold' && !l.is_disqualified)
  const qualifiedCount = qualifiedLeads.length
  const qualificationRate = totalLeads > 0 ? Math.round((qualifiedCount / totalLeads) * 100) : 0
  const pipelineLeads = leads.filter(l => !l.is_disqualified && l.classification !== 'cold' && !l.is_lost && l.current_stage !== 'Converted')
  const inPipeline = pipelineLeads.length
  const hotCount = leads.filter(l => l.classification === 'hot' && !l.is_disqualified).length
  const warmCount = leads.filter(l => l.classification === 'warm' && !l.is_disqualified).length
  const coldCount = leads.filter(l => l.classification === 'cold' || l.is_disqualified).length
  const sources = {}
  leads.forEach(l => { const src = l.source || 'Website'; sources[src] = (sources[src] || 0) + 1 })
  const convertedCount = leads.filter(l => l.current_stage === 'Converted').length
  const conversionRate = qualifiedCount > 0 ? Math.round((convertedCount / qualifiedCount) * 100) : 0
  const lostCount = leads.filter(l => l.is_lost).length
  const pipelineValue = pipelineLeads.reduce((sum, l) => sum + estimatePipelineValue(l.q1_revenue), 0)

  const stageCountMap = {}
  const stageValueMap = {}
  PIPELINE_STAGES.forEach(s => { stageCountMap[s.key] = 0; stageValueMap[s.key] = 0 })
  leads.forEach(l => {
    if (l.current_stage && stageCountMap[l.current_stage] !== undefined && !l.is_lost && !l.is_disqualified) {
      stageCountMap[l.current_stage]++
      stageValueMap[l.current_stage] += estimatePipelineValue(l.q1_revenue)
    }
  })
  const maxStageCount = Math.max(...Object.values(stageCountMap), 1)

  function formatValue(value) {
    if (value >= 1000000) return `KES ${(value / 1000000).toFixed(value % 1000000 === 0 ? 0 : 1)}M`
    if (value >= 1000) return `KES ${(value / 1000).toFixed(0)}K`
    return `KES ${value}`
  }

  function formatShortValue(value) {
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`
    if (value >= 1000) return `${(value / 1000).toFixed(0)}K`
    return String(value)
  }

  // Upcoming calls (always based on all leads, not period-filtered)
  const todayStr = new Date().toISOString().slice(0, 10)
  const todayLabel = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  const upcomingCalls = allLeads.filter(l =>
    l.current_stage === 'Scheduled' && !l.is_lost && !l.is_disqualified && l.scheduled_date
  ).sort((a, b) => {
    const dateA = `${a.scheduled_date} ${a.scheduled_time || ''}`
    const dateB = `${b.scheduled_date} ${b.scheduled_time || ''}`
    return dateA.localeCompare(dateB)
  })
  const todaysCalls = upcomingCalls.filter(l => l.scheduled_date === todayStr)
  const thisWeekCalls = upcomingCalls.filter(l => {
    if (!l.scheduled_date) return false
    const d = new Date(l.scheduled_date)
    const diffDays = Math.floor((d - now) / 86400000)
    return diffDays >= 0 && diffDays <= 7
  })

  // Follow-up reminders (always based on all leads)
  const followUpsDue = allLeads.filter(l =>
    l.follow_up_date && !l.is_lost && !l.is_disqualified &&
    new Date(l.follow_up_date) <= new Date(new Date().toDateString() + ' 23:59:59')
  ).sort((a, b) => a.follow_up_date.localeCompare(b.follow_up_date))

  // Conversion funnel
  const funnelStages = PIPELINE_STAGES.map(s => ({
    label: s.label,
    count: leads.filter(l => {
      if (l.is_lost || l.is_disqualified) return false
      const stageIdx = PIPELINE_STAGES.findIndex(ps => ps.key === l.current_stage)
      const thisIdx = PIPELINE_STAGES.findIndex(ps => ps.key === s.key)
      return stageIdx >= thisIdx
    }).length,
  }))
  const funnelMax = Math.max(...funnelStages.map(s => s.count), 1)

  const roleLabel = profile?.role === 'sales' ? 'Sales' : 'Admin'
  const classTotal = hotCount + warmCount + coldCount
  const sourcesArr = Object.entries(sources).sort((a, b) => b[1] - a[1])
  const stageCounts = PIPELINE_STAGES.map(s => [s.label, stageCountMap[s.key]])

  function handleExportCSV() {
    const headers = ['Metric', 'Value']
    const rows = [
      ['Period', getPeriodLabel(period)],
      ['Total Leads', String(totalLeads)], ['Qualified', String(qualifiedCount)], ['Disqualified', String(coldCount)],
      ['Qualification Rate', `${qualificationRate}%`], ['Hot', String(hotCount)], ['Warm', String(warmCount)],
      ['In Pipeline', String(inPipeline)], ['Converted', String(convertedCount)], ['Conversion Rate', `${conversionRate}%`],
      ['Pipeline Value', formatValue(pipelineValue)], ['Lost', String(lostCount)],
      [''], ['Stage', 'Count'], ...stageCounts.map(([s, c]) => [s, String(c)]),
      [''], ['Source', 'Count'], ...sourcesArr.map(([s, c]) => [s, String(c)]),
    ]
    exportCSV(headers, rows, `CAC_Dashboard_${new Date().toISOString().slice(0, 10)}`)
  }

  function handleExportPDF() {
    exportDashboardPDF({ totalLeads, qualifiedCount, coldCount, qualificationRate, hotCount, warmCount, inPipeline, convertedCount, conversionRate, pipelineValueFormatted: formatValue(pipelineValue), lostCount, stageCounts, sources: sourcesArr }, `CAC_Dashboard_${new Date().toISOString().slice(0, 10)}`)
  }

  function formatRelative(dateStr) {
    const ms = Date.now() - new Date(dateStr)
    const mins = Math.floor(ms / 60000); const hrs = Math.floor(ms / 3600000); const days = Math.floor(ms / 86400000)
    if (mins < 1) return 'Just now'; if (mins < 60) return `${mins}m ago`; if (hrs < 24) return `${hrs}h ago`; if (days < 7) return `${days}d ago`
    return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  }

  if (loading) {
    return (
      <div>
        <div className="page-header"><h1 className="page-title">{roleLabel} Dashboard</h1></div>
        <div className="dash-stats-row">{[1,2,3,4].map(i => <div key={i} className="skeleton skeleton-card" />)}</div>
        <div className="skeleton skeleton-card" style={{ height: 160, marginBottom: 'var(--space-xl)' }} />
      </div>
    )
  }

  return (
    <div className="dashboard">
      <div className="page-header dash-header">
        <div>
          <h1 className="page-title">{roleLabel} Dashboard</h1>
          <p className="page-subtitle">{totalLeads} lead{totalLeads !== 1 ? 's' : ''}{period.mode === 'month' ? ` in ${getPeriodLabel(period)}` : ''}</p>
        </div>
        <div className="dash-header-actions">
          <PeriodSelector value={period} onChange={setPeriod} />
          {totalLeads > 0 && (
            <div className="dash-export-btns">
              <button className="btn btn-secondary btn-sm" onClick={handleExportCSV}>CSV</button>
              <button className="btn btn-secondary btn-sm" onClick={handleExportPDF}>PDF</button>
            </div>
          )}
        </div>
      </div>

      {/* Upcoming calls + Follow-ups due */}
      {(todaysCalls.length > 0 || followUpsDue.length > 0) && (
        <div className="dash-grid-2" style={{ marginBottom: 'var(--space-md)' }}>
          {todaysCalls.length > 0 && (
            <div className="section-card dash-calls-card">
              <div className="section-card-header">
                <h2 className="section-card-title">Today's Calls</h2>
                <span className="dash-calls-date">{todayLabel}</span>
              </div>
              <div className="dash-calls-list">
                {todaysCalls.map(l => (
                  <div key={l.id} className="dash-call-item">
                    <span className="dash-call-time">{l.scheduled_time}</span>
                    <div className="dash-call-info">
                      <span className="dash-call-name">{l.full_name}</span>
                      <span className="dash-call-company">{l.company_name}</span>
                    </div>
                    <span className={`badge badge-${l.classification}`}>{l.classification.charAt(0).toUpperCase() + l.classification.slice(1)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {followUpsDue.length > 0 && (
            <div className="section-card">
              <div className="section-card-header">
                <h2 className="section-card-title">Follow-ups Due</h2>
                <span className="dash-calls-date">{followUpsDue.length} pending</span>
              </div>
              <div className="dash-calls-list">
                {followUpsDue.slice(0, 5).map(l => {
                  const isOverdue = new Date(l.follow_up_date) < new Date(new Date().toDateString())
                  return (
                    <div key={l.id} className="dash-call-item">
                      <span className={`dash-call-time ${isOverdue ? 'overdue' : ''}`}>{new Date(l.follow_up_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                      <div className="dash-call-info">
                        <span className="dash-call-name">{l.full_name}</span>
                        <span className="dash-call-company">{l.current_stage}</span>
                      </div>
                      {isOverdue && <span className="dash-overdue-tag">Overdue</span>}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Lead Metrics */}
      <div className="dash-stats-row">
        <div className="stat-card"><div className="stat-icon">{StatIcons.total}</div><div className="stat-label">Total Leads</div><div className="stat-value">{totalLeads}</div></div>
        <div className="stat-card"><div className="stat-icon">{StatIcons.qualified}</div><div className="stat-label">Qualified</div><div className="stat-value">{qualifiedCount}</div></div>
        <div className="stat-card"><div className="stat-icon">{StatIcons.rate}</div><div className="stat-label">Qualification Rate</div><div className="stat-value">{qualificationRate}%</div></div>
        <div className="stat-card stat-card-accent"><div className="stat-icon">{StatIcons.pipeline}</div><div className="stat-label">In Pipeline</div><div className="stat-value">{inPipeline}</div></div>
      </div>

      {/* Classification + Sources */}
      <div className="dash-grid-2">
        <div className="section-card">
          <div className="section-card-header"><h2 className="section-card-title">Lead Classification</h2></div>
          {classTotal > 0 ? (<>
            <div className="classification-bar">
              {hotCount > 0 && <div className="classification-segment hot" style={{ flex: hotCount }} />}
              {warmCount > 0 && <div className="classification-segment warm" style={{ flex: warmCount }} />}
              {coldCount > 0 && <div className="classification-segment cold" style={{ flex: coldCount }} />}
            </div>
            <div className="classification-legend">
              <div className="legend-item"><span className="legend-dot hot" /><span className="legend-label">Hot</span><span className="legend-value">{hotCount}</span></div>
              <div className="legend-item"><span className="legend-dot warm" /><span className="legend-label">Warm</span><span className="legend-value">{warmCount}</span></div>
              <div className="legend-item"><span className="legend-dot cold" /><span className="legend-label">Cold</span><span className="legend-value">{coldCount}</span></div>
            </div>
          </>) : (<div className="empty-state"><p className="empty-state-desc">No leads yet</p></div>)}
        </div>
        <div className="section-card">
          <div className="section-card-header"><h2 className="section-card-title">Lead Sources</h2></div>
          {Object.keys(sources).length > 0 ? (
            <div className="dash-sources-list">
              {sourcesArr.map(([src, count]) => (
                <div className="dash-source-row" key={src}>
                  <span className="dash-source-name">{src}</span>
                  <div className="dash-source-bar-wrap"><div className="dash-source-bar" style={{ width: `${(count / totalLeads) * 100}%` }} /></div>
                  <span className="dash-source-count">{count}</span>
                </div>
              ))}
            </div>
          ) : (<div className="empty-state"><p className="empty-state-desc">No leads yet</p></div>)}
        </div>
      </div>

      {/* Pipeline Metrics */}
      <div className="dash-stats-row">
        <div className="stat-card"><div className="stat-icon">{StatIcons.converted}</div><div className="stat-label">Converted</div><div className="stat-value">{convertedCount}</div></div>
        <div className="stat-card"><div className="stat-icon">{StatIcons.rate}</div><div className="stat-label">Conv. Rate</div><div className="stat-value">{conversionRate}%</div></div>
        <div className="stat-card"><div className="stat-icon">{StatIcons.value}</div><div className="stat-label">Pipeline Value</div><div className="stat-value">{formatValue(pipelineValue)}</div></div>
        <div className="stat-card"><div className="stat-icon">{StatIcons.lost}</div><div className="stat-label">Lost</div><div className="stat-value">{lostCount}</div></div>
      </div>

      {/* Leads by Stage */}
      <div className="section-card">
        <div className="section-card-header"><h2 className="section-card-title">Leads by Stage</h2></div>
        <div className="stage-chart">
          {PIPELINE_STAGES.map(stage => {
            const count = stageCountMap[stage.key]
            const stageVal = stageValueMap[stage.key]
            const pct = maxStageCount > 0 ? (count / maxStageCount) * 100 : 0
            return (
              <div className="stage-chart-row" key={stage.key}>
                <span className="stage-chart-label">{stage.label}</span>
                <div className="stage-chart-bar-track">
                  <div className={`stage-chart-bar ${count > 0 ? 'has-value' : ''}`} style={{ width: `${Math.max(pct, count > 0 ? 5 : 0)}%` }} />
                </div>
                <span className="stage-chart-count">{count}</span>
                {stageVal > 0 && <span className="stage-chart-value">{formatShortValue(stageVal)}</span>}
              </div>
            )
          })}
        </div>
      </div>

      {/* Conversion funnel */}
      {qualifiedCount > 0 && (
        <div className="section-card">
          <div className="section-card-header"><h2 className="section-card-title">Conversion Funnel</h2></div>
          <div className="dash-funnel">
            {funnelStages.map((stage, idx) => {
              const widthPct = funnelMax > 0 ? (stage.count / funnelMax) * 100 : 0
              const prevCount = idx > 0 ? funnelStages[idx - 1].count : null
              const dropOff = prevCount && prevCount > 0 ? Math.round(((prevCount - stage.count) / prevCount) * 100) : null
              return (
                <div className="dash-funnel-row" key={stage.label}>
                  <span className="dash-funnel-label">{stage.label}</span>
                  <div className="dash-funnel-bar-wrap">
                    <div className="dash-funnel-bar" style={{ width: `${Math.max(widthPct, stage.count > 0 ? 4 : 0)}%` }} />
                  </div>
                  <span className="dash-funnel-count">{stage.count}</span>
                  {dropOff !== null && dropOff > 0 && <span className="dash-funnel-drop">-{dropOff}%</span>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Recent activity */}
      {stageHistory.length > 0 && (
        <div className="section-card">
          <div className="section-card-header"><h2 className="section-card-title">Recent Activity</h2></div>
          <div className="dash-activity-list">
            {stageHistory.map(entry => (
              <div key={entry.id} className="dash-activity-item">
                <div className={`dash-activity-dot ${entry.stage === 'Lost' ? 'lost' : entry.stage === 'Converted' ? 'converted' : ''}`} />
                <div className="dash-activity-content">
                  <span className="dash-activity-text">
                    <strong>{entry.leads?.full_name || 'Lead'}</strong>
                    {entry.stage === 'Lost' ? ' was marked as lost' : ` moved to ${entry.stage}`}
                  </span>
                  <span className="dash-activity-meta">
                    {formatRelative(entry.entered_at)}
                    {entry.profiles?.name && ` · ${entry.profiles.name}`}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
