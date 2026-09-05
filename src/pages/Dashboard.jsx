import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { PIPELINE_STAGES, estimatePipelineValue } from '../lib/scoring'
import './Dashboard.css'

export default function Dashboard() {
  const { profile } = useAuth()
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchLeads()
  }, [])

  async function fetchLeads() {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false })

    if (data) setLeads(data)
    setLoading(false)
  }

  // Compute all metrics
  const totalLeads = leads.length
  const qualifiedLeads = leads.filter(l => l.classification !== 'cold' && !l.is_disqualified)
  const qualifiedCount = qualifiedLeads.length
  const qualificationRate = totalLeads > 0 ? Math.round((qualifiedCount / totalLeads) * 100) : 0

  // Active pipeline leads (qualified, not converted, not lost, not disqualified)
  const pipelineLeads = leads.filter(
    l => !l.is_disqualified && l.classification !== 'cold' && !l.is_lost && l.current_stage !== 'Converted'
  )
  const inPipeline = pipelineLeads.length

  // Classification counts
  const hotCount = leads.filter(l => l.classification === 'hot' && !l.is_disqualified).length
  const warmCount = leads.filter(l => l.classification === 'warm' && !l.is_disqualified).length
  const coldCount = leads.filter(l => l.classification === 'cold' || l.is_disqualified).length

  // Source breakdown
  const sources = {}
  leads.forEach(l => {
    const src = l.source || 'Website'
    sources[src] = (sources[src] || 0) + 1
  })

  // Pipeline metrics
  const convertedCount = leads.filter(l => l.current_stage === 'Converted').length
  const conversionRate = qualifiedCount > 0 ? Math.round((convertedCount / qualifiedCount) * 100) : 0
  const lostCount = leads.filter(l => l.is_lost).length

  // Pipeline value (sum of estimated values for active pipeline leads)
  const pipelineValue = pipelineLeads.reduce((sum, l) => sum + estimatePipelineValue(l.q1_revenue), 0)

  // Leads by stage
  const stageCountMap = {}
  PIPELINE_STAGES.forEach(s => { stageCountMap[s.key] = 0 })
  leads.forEach(l => {
    if (l.current_stage && stageCountMap[l.current_stage] !== undefined && !l.is_lost && !l.is_disqualified) {
      stageCountMap[l.current_stage]++
    }
  })
  const maxStageCount = Math.max(...Object.values(stageCountMap), 1)

  // Format currency
  function formatValue(value) {
    if (value >= 1000000) {
      return `KES ${(value / 1000000).toFixed(value % 1000000 === 0 ? 0 : 1)}M`
    }
    if (value >= 1000) {
      return `KES ${(value / 1000).toFixed(0)}K`
    }
    return `KES ${value}`
  }

  // Current month and year
  const now = new Date()
  const monthYear = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  const roleLabel = profile?.role === 'sales' ? 'Sales' : 'Admin'

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">{roleLabel} Dashboard</h1>
        </div>
        <p style={{ color: 'var(--text-secondary)' }}>Loading...</p>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">{roleLabel} Dashboard</h1>
        <p className="page-subtitle">
          {monthYear} · {totalLeads} total lead{totalLeads !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Top stat cards */}
      <div className="dash-stats-row">
        <div className="stat-card">
          <div className="stat-label">Total Leads</div>
          <div className="stat-value">{totalLeads}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Qualified</div>
          <div className="stat-value">{qualifiedCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Qualification Rate</div>
          <div className="stat-value">{qualificationRate}%</div>
        </div>
        <div className="stat-card stat-card-accent">
          <div className="stat-label">In Pipeline</div>
          <div className="stat-value">{inPipeline}</div>
        </div>
      </div>

      {/* Lead Classification Bar */}
      <div className="dash-section">
        <h2 className="dash-section-title">Lead Classification</h2>
        <div className="classification-bar">
          {hotCount > 0 && (
            <div
              className="classification-segment hot"
              style={{ flex: hotCount }}
            />
          )}
          {warmCount > 0 && (
            <div
              className="classification-segment warm"
              style={{ flex: warmCount }}
            />
          )}
          {coldCount > 0 && (
            <div
              className="classification-segment cold"
              style={{ flex: coldCount }}
            />
          )}
        </div>
        <div className="classification-legend">
          <span className="legend-item">
            <span className="legend-dot hot" /> Hot · {hotCount}
          </span>
          <span className="legend-item">
            <span className="legend-dot warm" /> Warm · {warmCount}
          </span>
          <span className="legend-item">
            <span className="legend-dot cold" /> Cold · {coldCount}
          </span>
        </div>
      </div>

      {/* Lead Sources */}
      <div className="dash-section">
        <h2 className="dash-section-title">Lead Sources</h2>
        <div className="dash-sources-row">
          {Object.entries(sources).sort((a, b) => b[1] - a[1]).map(([src, count]) => (
            <div className="stat-card" key={src}>
              <div className="stat-value">{count}</div>
              <div className="stat-label" style={{ marginBottom: 0, marginTop: '4px' }}>{src}</div>
            </div>
          ))}
          {Object.keys(sources).length === 0 && (
            <p style={{ color: 'var(--text-secondary)' }}>No leads yet.</p>
          )}
        </div>
      </div>

      {/* Pipeline Metrics */}
      <div className="dash-section">
        <h2 className="dash-section-title">Pipeline Metrics</h2>
        <div className="dash-stats-row">
          <div className="stat-card">
            <div className="stat-label">Converted</div>
            <div className="stat-value">{convertedCount}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Conv. Rate</div>
            <div className="stat-value">{conversionRate}%</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Pipeline Value</div>
            <div className="stat-value">{formatValue(pipelineValue)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Lost</div>
            <div className="stat-value">{lostCount}</div>
          </div>
        </div>
      </div>

      {/* Leads by Stage */}
      <div className="dash-section">
        <h2 className="dash-section-title">Leads by Stage</h2>
        <div className="stage-chart">
          {PIPELINE_STAGES.map(stage => {
            const count = stageCountMap[stage.key]
            const pct = maxStageCount > 0 ? (count / maxStageCount) * 100 : 0
            return (
              <div className="stage-chart-row" key={stage.key}>
                <span className="stage-chart-label">{stage.label}</span>
                <div className="stage-chart-bar-track">
                  <div
                    className="stage-chart-bar"
                    style={{ width: `${Math.max(pct, count > 0 ? 3 : 0)}%` }}
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
