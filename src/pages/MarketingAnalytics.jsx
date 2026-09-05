import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import './Dashboard.css'
import './MarketingAnalytics.css'

export default function MarketingAnalytics() {
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchLeads()
  }, [])

  async function fetchLeads() {
    const { data } = await supabase
      .from('leads')
      .select('id, classification, is_disqualified, source, created_at')
      .order('created_at', { ascending: false })

    if (data) setLeads(data)
    setLoading(false)
  }

  const totalLeads = leads.length
  const qualifiedCount = leads.filter(l => l.classification !== 'cold' && !l.is_disqualified).length
  const qualificationRate = totalLeads > 0 ? Math.round((qualifiedCount / totalLeads) * 100) : 0
  const coldCount = leads.filter(l => l.classification === 'cold' || l.is_disqualified).length

  const hotCount = leads.filter(l => l.classification === 'hot' && !l.is_disqualified).length
  const warmCount = leads.filter(l => l.classification === 'warm' && !l.is_disqualified).length

  // Source breakdown
  const sources = {}
  leads.forEach(l => {
    const src = l.source || 'Website'
    sources[src] = (sources[src] || 0) + 1
  })

  const now = new Date()
  const monthYear = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Marketing Analytics</h1>
        </div>
        <p style={{ color: 'var(--text-secondary)' }}>Loading...</p>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Marketing Analytics</h1>
        <p className="page-subtitle">
          {monthYear} · {totalLeads} total lead{totalLeads !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Top stats */}
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
        <div className="stat-card">
          <div className="stat-label">Cold / Disqualified</div>
          <div className="stat-value">{coldCount}</div>
        </div>
      </div>

      {/* Classification bar */}
      <div className="dash-section">
        <h2 className="dash-section-title">Lead Classification</h2>
        <div className="classification-bar">
          {hotCount > 0 && <div className="classification-segment hot" style={{ flex: hotCount }} />}
          {warmCount > 0 && <div className="classification-segment warm" style={{ flex: warmCount }} />}
          {coldCount > 0 && <div className="classification-segment cold" style={{ flex: coldCount }} />}
        </div>
        <div className="classification-legend">
          <span className="legend-item"><span className="legend-dot hot" /> Hot · {hotCount}</span>
          <span className="legend-item"><span className="legend-dot warm" /> Warm · {warmCount}</span>
          <span className="legend-item"><span className="legend-dot cold" /> Cold · {coldCount}</span>
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
    </div>
  )
}
