import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { PIPELINE_STAGES, estimatePipelineValue } from '../lib/scoring'
import './Dashboard.css'

/* ─── Inline icons for stat cards ─── */
const StatIcons = {
  total: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="7" cy="5.5" r="3" />
      <path d="M1.5 15.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <circle cx="13.5" cy="6" r="2" />
      <path d="M13.5 10.5c2 0 3.5 1.2 3.5 3" />
    </svg>
  ),
  qualified: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.5 9.5l2.5 2.5 5-5.5" />
      <circle cx="9" cy="9" r="7" />
    </svg>
  ),
  rate: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M2 14l4-5 3.5 3L16 4" />
      <path d="M12 4h4v4" />
    </svg>
  ),
  pipeline: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <rect x="2" y="11" width="3.5" height="5" rx="0.75" />
      <rect x="7.25" y="7" width="3.5" height="9" rx="0.75" />
      <rect x="12.5" y="3" width="3.5" height="13" rx="0.75" />
    </svg>
  ),
  converted: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M14 4l-8.5 8.5L2 9" />
    </svg>
  ),
  value: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="9" cy="9" r="7" />
      <path d="M9 5v8M7 7h3.5a1.5 1.5 0 0 1 0 3H7h4a1.5 1.5 0 0 1 0 3H7" />
    </svg>
  ),
  lost: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="9" cy="9" r="7" />
      <path d="M6 6l6 6M12 6l-6 6" />
    </svg>
  ),
}

export default function Dashboard() {
  const { profile } = useAuth()
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchLeads()
  }, [])

  async function fetchLeads() {
    const { data } = await supabase
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false })

    if (data) setLeads(data)
    setLoading(false)
  }

  // ── Metrics ──
  const totalLeads = leads.length
  const qualifiedLeads = leads.filter(l => l.classification !== 'cold' && !l.is_disqualified)
  const qualifiedCount = qualifiedLeads.length
  const qualificationRate = totalLeads > 0 ? Math.round((qualifiedCount / totalLeads) * 100) : 0

  const pipelineLeads = leads.filter(
    l => !l.is_disqualified && l.classification !== 'cold' && !l.is_lost && l.current_stage !== 'Converted'
  )
  const inPipeline = pipelineLeads.length

  const hotCount = leads.filter(l => l.classification === 'hot' && !l.is_disqualified).length
  const warmCount = leads.filter(l => l.classification === 'warm' && !l.is_disqualified).length
  const coldCount = leads.filter(l => l.classification === 'cold' || l.is_disqualified).length

  const sources = {}
  leads.forEach(l => {
    const src = l.source || 'Website'
    sources[src] = (sources[src] || 0) + 1
  })

  const convertedCount = leads.filter(l => l.current_stage === 'Converted').length
  const conversionRate = qualifiedCount > 0 ? Math.round((convertedCount / qualifiedCount) * 100) : 0
  const lostCount = leads.filter(l => l.is_lost).length
  const pipelineValue = pipelineLeads.reduce((sum, l) => sum + estimatePipelineValue(l.q1_revenue), 0)

  const stageCountMap = {}
  PIPELINE_STAGES.forEach(s => { stageCountMap[s.key] = 0 })
  leads.forEach(l => {
    if (l.current_stage && stageCountMap[l.current_stage] !== undefined && !l.is_lost && !l.is_disqualified) {
      stageCountMap[l.current_stage]++
    }
  })
  const maxStageCount = Math.max(...Object.values(stageCountMap), 1)

  function formatValue(value) {
    if (value >= 1000000) return `KES ${(value / 1000000).toFixed(value % 1000000 === 0 ? 0 : 1)}M`
    if (value >= 1000) return `KES ${(value / 1000).toFixed(0)}K`
    return `KES ${value}`
  }

  const now = new Date()
  const monthYear = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const roleLabel = profile?.role === 'sales' ? 'Sales' : 'Admin'
  const classTotal = hotCount + warmCount + coldCount

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">{roleLabel} Dashboard</h1>
          <p className="page-subtitle">{monthYear}</p>
        </div>
        <div className="dash-stats-row">
          {[1,2,3,4].map(i => <div key={i} className="skeleton skeleton-card" />)}
        </div>
        <div className="skeleton skeleton-card" style={{ height: 160, marginBottom: 'var(--space-xl)' }} />
        <div className="skeleton skeleton-card" style={{ height: 200 }} />
      </div>
    )
  }

  return (
    <div className="dashboard">
      <div className="page-header">
        <h1 className="page-title">{roleLabel} Dashboard</h1>
        <p className="page-subtitle">
          {monthYear} · {totalLeads} total lead{totalLeads !== 1 ? 's' : ''}
        </p>
      </div>

      {/* ── Lead Metrics ── */}
      <div className="dash-stats-row">
        <div className="stat-card">
          <div className="stat-icon">{StatIcons.total}</div>
          <div className="stat-label">Total Leads</div>
          <div className="stat-value">{totalLeads}</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">{StatIcons.qualified}</div>
          <div className="stat-label">Qualified</div>
          <div className="stat-value">{qualifiedCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">{StatIcons.rate}</div>
          <div className="stat-label">Qualification Rate</div>
          <div className="stat-value">{qualificationRate}%</div>
        </div>
        <div className="stat-card stat-card-accent">
          <div className="stat-icon">{StatIcons.pipeline}</div>
          <div className="stat-label">In Pipeline</div>
          <div className="stat-value">{inPipeline}</div>
        </div>
      </div>

      {/* ── Two-column grid: Classification + Sources ── */}
      <div className="dash-grid-2">
        {/* Lead Classification */}
        <div className="section-card">
          <div className="section-card-header">
            <h2 className="section-card-title">Lead Classification</h2>
          </div>
          {classTotal > 0 ? (
            <>
              <div className="classification-bar">
                {hotCount > 0 && (
                  <div className="classification-segment hot" style={{ flex: hotCount }} />
                )}
                {warmCount > 0 && (
                  <div className="classification-segment warm" style={{ flex: warmCount }} />
                )}
                {coldCount > 0 && (
                  <div className="classification-segment cold" style={{ flex: coldCount }} />
                )}
              </div>
              <div className="classification-legend">
                <div className="legend-item">
                  <span className="legend-dot hot" />
                  <span className="legend-label">Hot</span>
                  <span className="legend-value">{hotCount}</span>
                </div>
                <div className="legend-item">
                  <span className="legend-dot warm" />
                  <span className="legend-label">Warm</span>
                  <span className="legend-value">{warmCount}</span>
                </div>
                <div className="legend-item">
                  <span className="legend-dot cold" />
                  <span className="legend-label">Cold</span>
                  <span className="legend-value">{coldCount}</span>
                </div>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <p className="empty-state-desc">No leads yet</p>
            </div>
          )}
        </div>

        {/* Lead Sources */}
        <div className="section-card">
          <div className="section-card-header">
            <h2 className="section-card-title">Lead Sources</h2>
          </div>
          {Object.keys(sources).length > 0 ? (
            <div className="dash-sources-list">
              {Object.entries(sources).sort((a, b) => b[1] - a[1]).map(([src, count]) => (
                <div className="dash-source-row" key={src}>
                  <span className="dash-source-name">{src}</span>
                  <div className="dash-source-bar-wrap">
                    <div
                      className="dash-source-bar"
                      style={{ width: `${(count / totalLeads) * 100}%` }}
                    />
                  </div>
                  <span className="dash-source-count">{count}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <p className="empty-state-desc">No leads yet</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Pipeline Metrics ── */}
      <div className="dash-stats-row">
        <div className="stat-card">
          <div className="stat-icon">{StatIcons.converted}</div>
          <div className="stat-label">Converted</div>
          <div className="stat-value">{convertedCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">{StatIcons.rate}</div>
          <div className="stat-label">Conv. Rate</div>
          <div className="stat-value">{conversionRate}%</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">{StatIcons.value}</div>
          <div className="stat-label">Pipeline Value</div>
          <div className="stat-value">{formatValue(pipelineValue)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">{StatIcons.lost}</div>
          <div className="stat-label">Lost</div>
          <div className="stat-value">{lostCount}</div>
        </div>
      </div>

      {/* ── Leads by Stage ── */}
      <div className="section-card">
        <div className="section-card-header">
          <h2 className="section-card-title">Leads by Stage</h2>
        </div>
        <div className="stage-chart">
          {PIPELINE_STAGES.map(stage => {
            const count = stageCountMap[stage.key]
            const pct = maxStageCount > 0 ? (count / maxStageCount) * 100 : 0
            return (
              <div className="stage-chart-row" key={stage.key}>
                <span className="stage-chart-label">{stage.label}</span>
                <div className="stage-chart-bar-track">
                  <div
                    className={`stage-chart-bar ${count > 0 ? 'has-value' : ''}`}
                    style={{ width: `${Math.max(pct, count > 0 ? 5 : 0)}%` }}
                  />
                </div>
                <span className="stage-chart-count">{count}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
