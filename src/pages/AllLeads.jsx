import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { PIPELINE_STAGES } from '../lib/scoring'
import { exportCSV, exportLeadsPDF } from '../lib/exportUtils'
import LeadDetail from '../components/LeadDetail/LeadDetail'
import PeriodSelector, { filterByPeriod } from '../components/PeriodSelector/PeriodSelector'
import './AllLeads.css'

export default function AllLeads() {
  const { profile } = useAuth()
  const [allLeads, setAllLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedLead, setSelectedLead] = useState(null)
  const now = new Date()
  const [period, setPeriod] = useState({ mode: 'all', month: now.getMonth(), year: now.getFullYear() })

  // Gap 1: Filters
  const [filterClass, setFilterClass] = useState('')
  const [filterStage, setFilterStage] = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  // Gap 1: Sorting
  const [sortCol, setSortCol] = useState('created_at')
  const [sortDir, setSortDir] = useState('desc')

  // Gap 8: Bulk actions
  const [selected, setSelected] = useState(new Set())
  const [bulkAction, setBulkAction] = useState('')
  const [bulkStage, setBulkStage] = useState('')
  const [showBulkBar, setShowBulkBar] = useState(false)

  // Manual lead creation
  const [showCreateLead, setShowCreateLead] = useState(false)
  const [creatingLead, setCreatingLead] = useState(false)
  const [newLead, setNewLead] = useState({
    full_name: '', company_name: '', email: '', phone: '', has_whatsapp: false,
    classification: 'warm', current_stage: PIPELINE_STAGES[0].key, source: 'Manual Entry',
  })
  const [toast, setToast] = useState({ show: false, type: '', text: '' })

  useEffect(() => { fetchLeads() }, [])
  useEffect(() => { setShowBulkBar(selected.size > 0) }, [selected.size])
  useEffect(() => {
    if (toast.show) {
      const timer = setTimeout(() => setToast({ show: false, type: '', text: '' }), 4000)
      return () => clearTimeout(timer)
    }
  }, [toast.show])

  function showToast(type, text) { setToast({ show: true, type, text }) }

  async function handleCreateLead(e) {
    e.preventDefault()
    setCreatingLead(true)
    const { data, error } = await supabase
      .from('leads')
      .insert({
        full_name: newLead.full_name.trim(),
        company_name: newLead.company_name.trim(),
        email: newLead.email.trim(),
        phone: newLead.phone.trim(),
        has_whatsapp: newLead.has_whatsapp,
        classification: newLead.classification,
        current_stage: newLead.current_stage,
        source: newLead.source.trim() || 'Manual Entry',
      })
      .select()
      .single()

    if (error || !data) {
      showToast('error', error?.message || 'Failed to create lead')
      setCreatingLead(false)
      return
    }

    await supabase.from('lead_stage_history').insert({ lead_id: data.id, stage: data.current_stage, moved_by: profile?.id })
    supabase.functions.invoke('notify-lead', { body: { lead_id: data.id, team_only: true } })
      .catch(err => console.error('[Email] notify-lead invoke failed:', err))

    setAllLeads(prev => [data, ...prev])
    setCreatingLead(false)
    setShowCreateLead(false)
    setNewLead({ full_name: '', company_name: '', email: '', phone: '', has_whatsapp: false, classification: 'warm', current_stage: PIPELINE_STAGES[0].key, source: 'Manual Entry' })
    showToast('success', `${data.full_name} added to the pipeline`)
  }

  async function fetchLeads() {
    const { data } = await supabase.from('leads').select('*').order('created_at', { ascending: false })
    if (data) setAllLeads(data)
    setLoading(false)
  }

  // Apply period filter first
  const leads = filterByPeriod(allLeads, period)

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

  function getStatus(lead) {
    if (lead.is_lost) return 'lost'
    if (lead.is_disqualified || lead.classification === 'cold') return 'disqualified'
    return 'active'
  }

  // Apply filters + search
  let filtered = leads.filter(l => {
    if (search.trim()) {
      const q = search.toLowerCase()
      if (!l.full_name?.toLowerCase().includes(q) && !l.company_name?.toLowerCase().includes(q) && !l.email?.toLowerCase().includes(q)) return false
    }
    if (filterClass) {
      const cls = l.is_disqualified ? 'cold' : l.classification
      if (cls !== filterClass) return false
    }
    if (filterStage) {
      if (l.is_lost && filterStage !== 'Lost') return false
      if (!l.is_lost && l.current_stage !== filterStage) return false
    }
    if (filterStatus) {
      if (getStatus(l) !== filterStatus) return false
    }
    return true
  })

  // Apply sorting
  filtered = [...filtered].sort((a, b) => {
    let valA, valB
    switch (sortCol) {
      case 'full_name': valA = a.full_name?.toLowerCase() || ''; valB = b.full_name?.toLowerCase() || ''; break
      case 'company_name': valA = a.company_name?.toLowerCase() || ''; valB = b.company_name?.toLowerCase() || ''; break
      case 'classification': valA = a.classification || ''; valB = b.classification || ''; break
      case 'total_score': valA = a.total_score || 0; valB = b.total_score || 0; break
      case 'current_stage': valA = a.current_stage || ''; valB = b.current_stage || ''; break
      case 'source': valA = a.source || ''; valB = b.source || ''; break
      default: valA = a.created_at || ''; valB = b.created_at || ''
    }
    if (valA < valB) return sortDir === 'asc' ? -1 : 1
    if (valA > valB) return sortDir === 'asc' ? 1 : -1
    return 0
  })

  function handleSort(col) {
    if (sortCol === col) { setSortDir(d => d === 'asc' ? 'desc' : 'asc') }
    else { setSortCol(col); setSortDir('asc') }
  }

  function sortIcon(col) {
    if (sortCol !== col) return '↕'
    return sortDir === 'asc' ? '↑' : '↓'
  }

  // Gap 8: Bulk selection
  function toggleSelect(id) {
    setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }

  function toggleSelectAll() {
    if (selected.size === filtered.length) { setSelected(new Set()) }
    else { setSelected(new Set(filtered.map(l => l.id))) }
  }

  async function handleBulkAction() {
    if (bulkAction === 'move' && bulkStage) {
      const ids = [...selected]
      const previousStages = new Map(allLeads.filter(l => selected.has(l.id)).map(l => [l.id, l.current_stage]))
      await Promise.all(ids.map(id => supabase.from('leads').update({ current_stage: bulkStage }).eq('id', id)))
      await Promise.all(ids.map(id => supabase.from('lead_stage_history').insert({
        lead_id: id, stage: bulkStage, moved_by: profile?.id,
      })))
      ids.forEach(id => {
        supabase.functions.invoke('notify-lead-stage', {
          body: { lead_id: id, event: 'stage_changed', previous_stage: previousStages.get(id) },
        }).catch(err => console.error('[Email] notify-lead-stage invoke failed:', err))
      })
      setAllLeads(prev => prev.map(l => selected.has(l.id) ? { ...l, current_stage: bulkStage } : l))
    } else if (bulkAction === 'lost') {
      const ids = [...selected]
      await Promise.all(ids.map(id => supabase.from('leads').update({ is_lost: true, lost_reason: 'Bulk action' }).eq('id', id)))
      await Promise.all(ids.map(id => supabase.from('lead_stage_history').insert({
        lead_id: id, stage: 'Lost', moved_by: profile?.id,
      })))
      ids.forEach(id => {
        supabase.functions.invoke('notify-lead-stage', {
          body: { lead_id: id, event: 'lost' },
        }).catch(err => console.error('[Email] notify-lead-stage invoke failed:', err))
      })
      setAllLeads(prev => prev.map(l => selected.has(l.id) ? { ...l, is_lost: true, lost_reason: 'Bulk action' } : l))
    }
    setSelected(new Set())
    setBulkAction('')
    setBulkStage('')
  }

  // Export handlers
  function handleExportCSV() {
    const data = filtered
    const headers = ['Name', 'Company', 'Email', 'Phone', 'Classification', 'Score', 'Stage', 'Source', 'Scheduled', 'Date']
    const rows = data.map(l => [
      l.full_name, l.company_name, l.email, l.phone,
      classLabel(l), `${l.total_score}/21`, stageLabel(l),
      l.source || 'Website',
      l.scheduled_day && l.scheduled_time ? `${l.scheduled_day} ${l.scheduled_time}` : '',
      l.created_at ? new Date(l.created_at).toLocaleDateString('en-GB') : '',
    ])
    exportCSV(headers, rows, `SDFM_Leads_${new Date().toISOString().slice(0, 10)}`)
  }

  function handleExportPDF() { exportLeadsPDF(filtered, `SDFM_Leads_${new Date().toISOString().slice(0, 10)}`) }

  const hasFilters = filterClass || filterStage || filterStatus
  function clearFilters() { setFilterClass(''); setFilterStage(''); setFilterStatus('') }

  if (loading) {
    return (
      <div>
        <div className="page-header leads-header"><h1 className="page-title">All Leads</h1></div>
        <div className="section-card">{[1,2,3].map(i => <div key={i} className="skeleton skeleton-bar" style={{ width: `${100 - i * 15}%` }} />)}</div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header leads-header">
        <div>
          <h1 className="page-title">All Leads</h1>
          <p className="page-subtitle">{leads.length} lead{leads.length !== 1 ? 's' : ''}{hasFilters ? ` · ${filtered.length} shown` : ''}</p>
        </div>
        <div className="leads-header-actions">
          <PeriodSelector value={period} onChange={setPeriod} />
          {leads.length > 0 && (
            <>
              <div className="leads-search-wrap">
                <svg className="leads-search-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="7" cy="7" r="5" /><path d="M11 11l3.5 3.5" /></svg>
                <input type="text" className="leads-search" placeholder="Search leads..." value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <div className="leads-export-btns">
                <button className="btn btn-secondary btn-sm" onClick={handleExportCSV}>CSV</button>
                <button className="btn btn-secondary btn-sm" onClick={handleExportPDF}>PDF</button>
              </div>
            </>
          )}
          <button className="btn btn-primary btn-sm" onClick={() => setShowCreateLead(true)}>+ Create Lead</button>
        </div>
      </div>

      {/* Gap 1: Filter bar */}
      {leads.length > 0 && (
        <div className="leads-filter-bar">
          <select className="leads-filter-select" value={filterClass} onChange={e => setFilterClass(e.target.value)}>
            <option value="">All Classes</option>
            <option value="hot">Hot</option>
            <option value="warm">Warm</option>
            <option value="cold">Cold</option>
          </select>
          <select className="leads-filter-select" value={filterStage} onChange={e => setFilterStage(e.target.value)}>
            <option value="">All Stages</option>
            {PIPELINE_STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            <option value="Disqualified">Disqualified</option>
            <option value="Lost">Lost</option>
          </select>
          <select className="leads-filter-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="lost">Lost</option>
            <option value="disqualified">Disqualified</option>
          </select>
          {hasFilters && <button className="leads-filter-clear" onClick={clearFilters}>Clear filters</button>}
        </div>
      )}

      {leads.length === 0 ? (
        <div className="section-card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="16" cy="12" r="6" /><path d="M4 32c0-6 5-10 12-10s12 4 12 10" /><path d="M28 12l6 6M34 12l-6 6" /></svg>
            </div>
            <div className="empty-state-title">No leads yet</div>
            <p className="empty-state-desc">Share the intake form to start receiving leads.</p>
          </div>
        </div>
      ) : (
        <>
          {/* Desktop table with sortable headers */}
          <div className="leads-table-wrap section-card">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}><input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleSelectAll} /></th>
                  <th className="sortable-th" onClick={() => handleSort('full_name')}>Name <span className="sort-icon">{sortIcon('full_name')}</span></th>
                  <th className="sortable-th" onClick={() => handleSort('company_name')}>Company <span className="sort-icon">{sortIcon('company_name')}</span></th>
                  <th className="sortable-th" onClick={() => handleSort('classification')}>Class <span className="sort-icon">{sortIcon('classification')}</span></th>
                  <th className="sortable-th" onClick={() => handleSort('total_score')}>Score <span className="sort-icon">{sortIcon('total_score')}</span></th>
                  <th className="sortable-th" onClick={() => handleSort('current_stage')}>Stage <span className="sort-icon">{sortIcon('current_stage')}</span></th>
                  <th className="sortable-th" onClick={() => handleSort('source')}>Source <span className="sort-icon">{sortIcon('source')}</span></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(lead => (
                  <tr key={lead.id} className={`leads-row-clickable ${selected.has(lead.id) ? 'row-selected' : ''}`}>
                    <td onClick={e => e.stopPropagation()}><input type="checkbox" checked={selected.has(lead.id)} onChange={() => toggleSelect(lead.id)} /></td>
                    <td className="leads-name" onClick={() => setSelectedLead(lead)}>{lead.full_name}</td>
                    <td onClick={() => setSelectedLead(lead)}>{lead.company_name}</td>
                    <td onClick={() => setSelectedLead(lead)}><span className={badgeClass(lead)}>{classLabel(lead)}</span></td>
                    <td className="leads-score" onClick={() => setSelectedLead(lead)}>{lead.total_score}/21</td>
                    <td onClick={() => setSelectedLead(lead)}><span className={stageClass(lead)}>{stageLabel(lead)}</span></td>
                    <td className="leads-source" onClick={() => setSelectedLead(lead)}>{lead.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="empty-state" style={{ padding: 'var(--space-xl)' }}>
                <p className="empty-state-desc">No leads match your filters</p>
              </div>
            )}
          </div>

          {/* Mobile card list */}
          <div className="leads-mobile-list">
            {filtered.map(lead => (
              <div key={lead.id} className="leads-mobile-card leads-row-clickable" onClick={() => setSelectedLead(lead)}>
                <div className="leads-mobile-card-top">
                  <div>
                    <div className="leads-mobile-name">{lead.full_name}</div>
                    <div className="leads-mobile-company">{lead.company_name}</div>
                  </div>
                  <span className={badgeClass(lead)}>{classLabel(lead)}</span>
                </div>
                <div className="leads-mobile-card-bottom">
                  <span className="leads-mobile-meta"><span className="leads-mobile-label">Score</span>{lead.total_score}/21</span>
                  <span className={`leads-mobile-meta ${stageClass(lead)}`}><span className="leads-mobile-label">Stage</span>{stageLabel(lead)}</span>
                  <span className="leads-mobile-meta"><span className="leads-mobile-label">Source</span>{lead.source}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Gap 8: Bulk action bar */}
      {showBulkBar && (
        <div className="leads-bulk-bar">
          <span className="leads-bulk-count">{selected.size} selected</span>
          <select className="leads-filter-select" value={bulkAction} onChange={e => { setBulkAction(e.target.value); setBulkStage('') }}>
            <option value="">Choose action...</option>
            <option value="move">Move to Stage</option>
            <option value="lost">Mark as Lost</option>
          </select>
          {bulkAction === 'move' && (
            <select className="leads-filter-select" value={bulkStage} onChange={e => setBulkStage(e.target.value)}>
              <option value="">Select stage...</option>
              {PIPELINE_STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          )}
          <button className="btn btn-primary btn-sm" onClick={handleBulkAction} disabled={!bulkAction || (bulkAction === 'move' && !bulkStage)}>Apply</button>
          <button className="btn btn-secondary btn-sm" onClick={() => { setSelected(new Set()); setBulkAction('') }}>Cancel</button>
        </div>
      )}

      {selectedLead && (
        <LeadDetail lead={selectedLead} onClose={() => setSelectedLead(null)} onLeadUpdated={(updated) => {
          setAllLeads(prev => prev.map(l => l.id === updated.id ? updated : l))
          setSelectedLead(null)
        }} />
      )}

      {/* Create Lead Modal */}
      {showCreateLead && (
        <div className="modal-overlay" onClick={() => setShowCreateLead(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Create Lead</h3>
            <p className="modal-subtitle">Manually add a lead straight into the pipeline.</p>
            <form onSubmit={handleCreateLead}>
              <div className="form-group">
                <label className="form-label">Full Name</label>
                <input className="form-input" required value={newLead.full_name} onChange={e => setNewLead({ ...newLead, full_name: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Company</label>
                <input className="form-input" required value={newLead.company_name} onChange={e => setNewLead({ ...newLead, company_name: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input className="form-input" type="email" required value={newLead.email} onChange={e => setNewLead({ ...newLead, email: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Phone</label>
                <input className="form-input" required value={newLead.phone} onChange={e => setNewLead({ ...newLead, phone: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
                  <input type="checkbox" checked={newLead.has_whatsapp} onChange={e => setNewLead({ ...newLead, has_whatsapp: e.target.checked })} />
                  Has WhatsApp
                </label>
              </div>
              <div className="form-group">
                <label className="form-label">Classification</label>
                <select className="form-input" value={newLead.classification} onChange={e => setNewLead({ ...newLead, classification: e.target.value })}>
                  <option value="hot">Hot</option>
                  <option value="warm">Warm</option>
                  <option value="cold">Cold</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Pipeline Stage</label>
                <select className="form-input" value={newLead.current_stage} onChange={e => setNewLead({ ...newLead, current_stage: e.target.value })}>
                  {PIPELINE_STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Source</label>
                <input className="form-input" value={newLead.source} onChange={e => setNewLead({ ...newLead, source: e.target.value })} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreateLead(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={creatingLead}>{creatingLead ? 'Creating...' : 'Create Lead'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast.show && (
        <div className={`toast toast-${toast.type}`}>
          {toast.type === 'success' ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 8.5l3 3 5-6" /></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="8" cy="8" r="6" /><path d="M8 5v3.5M8 10.5v.5" /></svg>
          )}
          {toast.text}
        </div>
      )}
    </div>
  )
}
