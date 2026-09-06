import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import './AllLeads.css'

export default function AllLeads() {
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

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

  function badgeClass(lead) {
    if (lead.is_disqualified) return 'badge badge-cold'
    return `badge badge-${lead.classification}`
  }

  function classLabel(lead) {
    if (lead.is_disqualified) return 'Cold'
    return lead.classification.charAt(0).toUpperCase() + lead.classification.slice(1)
  }

  function stageLabel(lead) {
    if (lead.is_lost) return 'Lost'
    return lead.current_stage
  }

  function stageClass(lead) {
    if (lead.is_lost) return 'stage-lost'
    if (lead.current_stage === 'Converted') return 'stage-converted'
    if (lead.current_stage === 'Disqualified') return 'stage-disqualified'
    return ''
  }

  // Filter leads by search
  const filtered = leads.filter(l => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      l.full_name?.toLowerCase().includes(q) ||
      l.company_name?.toLowerCase().includes(q) ||
      l.email?.toLowerCase().includes(q)
    )
  })

  if (loading) {
    return (
      <div>
        <div className="page-header leads-header">
          <h1 className="page-title">All Leads</h1>
        </div>
        <div className="section-card">
          {[1,2,3].map(i => (
            <div key={i} className="skeleton skeleton-bar" style={{ width: `${100 - i * 15}%` }} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header leads-header">
        <div>
          <h1 className="page-title">All Leads</h1>
          <p className="page-subtitle">
            {leads.length} lead{leads.length !== 1 ? 's' : ''}
          </p>
        </div>
        {leads.length > 0 && (
          <div className="leads-search-wrap">
            <svg className="leads-search-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="7" cy="7" r="5" />
              <path d="M11 11l3.5 3.5" />
            </svg>
            <input
              type="text"
              className="leads-search"
              placeholder="Search leads..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        )}
      </div>

      {leads.length === 0 ? (
        <div className="section-card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="16" cy="12" r="6" />
                <path d="M4 32c0-6 5-10 12-10s12 4 12 10" />
                <path d="M28 12l6 6M34 12l-6 6" />
              </svg>
            </div>
            <div className="empty-state-title">No leads yet</div>
            <p className="empty-state-desc">
              Share the intake form to start receiving leads.
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="leads-table-wrap section-card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Company</th>
                  <th>Class</th>
                  <th>Score</th>
                  <th>Stage</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(lead => (
                  <tr key={lead.id}>
                    <td className="leads-name">{lead.full_name}</td>
                    <td>{lead.company_name}</td>
                    <td><span className={badgeClass(lead)}>{classLabel(lead)}</span></td>
                    <td className="leads-score">{lead.total_score}/21</td>
                    <td><span className={stageClass(lead)}>{stageLabel(lead)}</span></td>
                    <td className="leads-source">{lead.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && search && (
              <div className="empty-state" style={{ padding: 'var(--space-xl)' }}>
                <p className="empty-state-desc">No leads match "{search}"</p>
              </div>
            )}
          </div>

          {/* Mobile card list */}
          <div className="leads-mobile-list">
            {filtered.map(lead => (
              <div key={lead.id} className="leads-mobile-card">
                <div className="leads-mobile-card-top">
                  <div>
                    <div className="leads-mobile-name">{lead.full_name}</div>
                    <div className="leads-mobile-company">{lead.company_name}</div>
                  </div>
                  <span className={badgeClass(lead)}>{classLabel(lead)}</span>
                </div>
                <div className="leads-mobile-card-bottom">
                  <span className="leads-mobile-meta">
                    <span className="leads-mobile-label">Score</span>
                    {lead.total_score}/21
                  </span>
                  <span className={`leads-mobile-meta ${stageClass(lead)}`}>
                    <span className="leads-mobile-label">Stage</span>
                    {stageLabel(lead)}
                  </span>
                  <span className="leads-mobile-meta">
                    <span className="leads-mobile-label">Source</span>
                    {lead.source}
                  </span>
                </div>
              </div>
            ))}
            {filtered.length === 0 && search && (
              <div className="empty-state" style={{ padding: 'var(--space-xl)' }}>
                <p className="empty-state-desc">No leads match "{search}"</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
