import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import './AllLeads.css'

export default function AllLeads() {
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

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">All Leads</h1>
        </div>
        <p style={{ color: 'var(--text-secondary)' }}>Loading...</p>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header leads-header">
        <h1 className="page-title">All Leads</h1>
        <span className="leads-count">{leads.length} lead{leads.length !== 1 ? 's' : ''}</span>
      </div>

      {leads.length === 0 ? (
        <p style={{ color: 'var(--text-secondary)' }}>No leads yet. Share the intake form to get started.</p>
      ) : (
        <div className="leads-table-wrap">
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
              {leads.map(lead => (
                <tr key={lead.id}>
                  <td className="leads-name">{lead.full_name}</td>
                  <td>{lead.company_name}</td>
                  <td><span className={badgeClass(lead)}>{classLabel(lead)}</span></td>
                  <td>{lead.total_score}/21</td>
                  <td><span className={stageClass(lead)}>{stageLabel(lead)}</span></td>
                  <td className="leads-source">{lead.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
