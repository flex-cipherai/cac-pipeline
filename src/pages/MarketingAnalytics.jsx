import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { exportCSV } from '../lib/exportUtils'
import PeriodSelector, { filterByPeriod, getPeriodLabel } from '../components/PeriodSelector/PeriodSelector'
import './Dashboard.css'
import './MarketingAnalytics.css'

const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export default function MarketingAnalytics() {
  const [allLeads, setAllLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const now = new Date()
  const [period, setPeriod] = useState({ mode: 'all', month: now.getMonth(), year: now.getFullYear() })

  useEffect(() => { fetchLeads() }, [])

  async function fetchLeads() {
    const { data } = await supabase
      .from('leads')
      .select('id, classification, is_disqualified, source, created_at, is_lost, current_stage')
      .order('created_at', { ascending: false })
    if (data) setAllLeads(data)
    setLoading(false)
  }

  const leads = filterByPeriod(allLeads, period)

  const totalLeads = leads.length
  const qualifiedCount = leads.filter(l => l.classification !== 'cold' && !l.is_disqualified).length
  const qualificationRate = totalLeads > 0 ? Math.round((qualifiedCount / totalLeads) * 100) : 0
  const coldCount = leads.filter(l => l.classification === 'cold' || l.is_disqualified).length
  const hotCount = leads.filter(l => l.classification === 'hot' && !l.is_disqualified).length
  const warmCount = leads.filter(l => l.classification === 'warm' && !l.is_disqualified).length
  const lostCount = leads.filter(l => l.is_lost).length

  // Source breakdown with quality
  const sourceData = {}
  leads.forEach(l => {
    const src = l.source || 'Website'
    if (!sourceData[src]) sourceData[src] = { total: 0, qualified: 0, cold: 0 }
    sourceData[src].total++
    if (l.classification !== 'cold' && !l.is_disqualified) sourceData[src].qualified++
    else sourceData[src].cold++
  })
  const sourcesArr = Object.entries(sourceData).sort((a, b) => b[1].total - a[1].total)
  const maxSourceCount = sourcesArr.length > 0 ? Math.max(...sourcesArr.map(([, d]) => d.total)) : 1

  // Monthly trend (last 6 months from allLeads, regardless of period filter)
  const monthlyTrend = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const m = d.getMonth()
    const y = d.getFullYear()
    const monthLeads = allLeads.filter(l => {
      const ld = new Date(l.created_at)
      return ld.getMonth() === m && ld.getFullYear() === y
    })
    monthlyTrend.push({
      label: `${SHORT_MONTHS[m]}`,
      total: monthLeads.length,
      qualified: monthLeads.filter(l => l.classification !== 'cold' && !l.is_disqualified).length,
    })
  }
  const trendMax = Math.max(...monthlyTrend.map(m => m.total), 1)

  // Quality trend (qualification rate per month)
  const qualityTrend = monthlyTrend.map(m => ({
    ...m,
    rate: m.total > 0 ? Math.round((m.qualified / m.total) * 100) : 0,
  }))

  function handleExportCSV() {
    const headers = ['Metric', 'Value']
    const rows = [
      ['Period', getPeriodLabel(period)],
      ['Total Leads', String(totalLeads)],
      ['Qualified', String(qualifiedCount)],
      ['Cold / Disqualified', String(coldCount)],
      ['Qualification Rate', `${qualificationRate}%`],
      ['Hot', String(hotCount)],
      ['Warm', String(warmCount)],
      ['Lost', String(lostCount)],
      [''],
      ['Source', 'Total', 'Qualified', 'Cold'],
      ...sourcesArr.map(([src, d]) => [src, String(d.total), String(d.qualified), String(d.cold)]),
    ]
    exportCSV(headers, rows, `SDFM_Marketing_${new Date().toISOString().slice(0, 10)}`)
  }

  if (loading) {
    return (
      <div>
        <div className="page-header"><h1 className="page-title">Marketing Analytics</h1></div>
        <div className="dash-stats-row">{[1,2,3,4].map(i => <div key={i} className="skeleton skeleton-card" />)}</div>
        <div className="skeleton skeleton-card" style={{ height: 200 }} />
      </div>
    )
  }

  const classTotal = hotCount + warmCount + coldCount

  return (
    <div>
      <div className="page-header dash-header">
        <div>
          <h1 className="page-title">Marketing Analytics</h1>
          <p className="page-subtitle">{totalLeads} lead{totalLeads !== 1 ? 's' : ''}{period.mode === 'month' ? ` in ${getPeriodLabel(period)}` : ''}</p>
        </div>
        <div className="dash-header-actions">
          <PeriodSelector value={period} onChange={setPeriod} />
          {totalLeads > 0 && (
            <button className="btn btn-secondary btn-sm" onClick={handleExportCSV}>CSV</button>
          )}
        </div>
      </div>

      {/* Top stats */}
      <div className="dash-stats-row">
        <div className="stat-card">
          <div className="stat-icon">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="7" cy="5.5" r="3" /><path d="M1.5 15.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5" /><circle cx="13.5" cy="6" r="2" /><path d="M13.5 10.5c2 0 3.5 1.2 3.5 3" /></svg>
          </div>
          <div className="stat-label">Total Leads</div>
          <div className="stat-value">{totalLeads}</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5.5 9.5l2.5 2.5 5-5.5" /><circle cx="9" cy="9" r="7" /></svg>
          </div>
          <div className="stat-label">Qualified</div>
          <div className="stat-value">{qualifiedCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 14l4-5 3.5 3L16 4" /><path d="M12 4h4v4" /></svg>
          </div>
          <div className="stat-label">Qualification Rate</div>
          <div className="stat-value">{qualificationRate}%</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="9" cy="9" r="7" /><path d="M6 6l6 6M12 6l-6 6" /></svg>
          </div>
          <div className="stat-label">Cold / Disqualified</div>
          <div className="stat-value">{coldCount}</div>
        </div>
      </div>

      {/* Lead Volume Trend + Classification */}
      <div className="dash-grid-2">
        {/* Lead Volume Trend (6 months) */}
        <div className="section-card">
          <div className="section-card-header"><h2 className="section-card-title">Lead Volume (6 Months)</h2></div>
          <div className="mkt-bar-chart">
            {monthlyTrend.map((m, idx) => (
              <div className="mkt-bar-col" key={idx}>
                <div className="mkt-bar-track">
                  <div className="mkt-bar-fill mkt-bar-total" style={{ height: `${(m.total / trendMax) * 100}%` }} />
                  <div className="mkt-bar-fill mkt-bar-qualified" style={{ height: `${(m.qualified / trendMax) * 100}%` }} />
                </div>
                <span className="mkt-bar-label">{m.label}</span>
                <span className="mkt-bar-value">{m.total}</span>
              </div>
            ))}
          </div>
          <div className="mkt-bar-legend">
            <span className="mkt-bar-legend-item"><span className="mkt-bar-legend-dot total" /> Total</span>
            <span className="mkt-bar-legend-item"><span className="mkt-bar-legend-dot qualified" /> Qualified</span>
          </div>
        </div>

        {/* Classification */}
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
          </>) : (<div className="empty-state"><p className="empty-state-desc">No leads in this period</p></div>)}
        </div>
      </div>

      {/* Source Effectiveness */}
      <div className="section-card">
        <div className="section-card-header"><h2 className="section-card-title">Source Effectiveness</h2></div>
        {sourcesArr.length > 0 ? (
          <div className="mkt-source-table">
            {sourcesArr.map(([src, data]) => {
              const qualRate = data.total > 0 ? Math.round((data.qualified / data.total) * 100) : 0
              return (
                <div className="mkt-source-row" key={src}>
                  <span className="mkt-source-name">{src}</span>
                  <div className="mkt-source-bar-track">
                    <div className="mkt-source-bar-qualified" style={{ width: `${(data.qualified / maxSourceCount) * 100}%` }} />
                    <div className="mkt-source-bar-cold" style={{ width: `${(data.cold / maxSourceCount) * 100}%`, left: `${(data.qualified / maxSourceCount) * 100}%` }} />
                  </div>
                  <div className="mkt-source-stats">
                    <span className="mkt-source-total">{data.total}</span>
                    <span className="mkt-source-rate">{qualRate}%</span>
                  </div>
                </div>
              )
            })}
            <div className="mkt-source-legend">
              <span className="mkt-bar-legend-item"><span className="mkt-bar-legend-dot qualified" /> Qualified</span>
              <span className="mkt-bar-legend-item"><span className="mkt-bar-legend-dot cold" /> Cold</span>
            </div>
          </div>
        ) : (
          <div className="empty-state"><p className="empty-state-desc">No leads in this period</p></div>
        )}
      </div>

      {/* Quality Trend */}
      <div className="section-card">
        <div className="section-card-header"><h2 className="section-card-title">Lead Quality Trend (6 Months)</h2></div>
        <div className="mkt-quality-chart">
          {qualityTrend.map((m, idx) => (
            <div className="mkt-quality-col" key={idx}>
              <div className="mkt-quality-bar-wrap">
                <div className="mkt-quality-bar" style={{ height: `${m.rate}%` }} />
              </div>
              <span className="mkt-quality-rate">{m.rate}%</span>
              <span className="mkt-bar-label">{m.label}</span>
            </div>
          ))}
        </div>
        <p className="mkt-quality-hint">Qualification rate per month (higher is better)</p>
      </div>
    </div>
  )
}
