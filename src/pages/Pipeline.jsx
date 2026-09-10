import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { PIPELINE_STAGES } from '../lib/scoring'
import LeadDetail from '../components/LeadDetail/LeadDetail'
import PeriodSelector, { filterByPeriod } from '../components/PeriodSelector/PeriodSelector'
import './Pipeline.css'

const LOST_REASONS = [
  'Unresponsive — no reply after multiple follow-ups',
  'Not ready — decided to delay the project',
  'Budget constraints — cannot commit financially',
  'Went with a competitor',
  "Scope mismatch — needs don't align with our services",
  'Internal changes — leadership or priorities shifted',
]

export default function Pipeline() {
  const { profile } = useAuth()
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [draggedLead, setDraggedLead] = useState(null)
  const [dragOverStage, setDragOverStage] = useState(null)
  const [moveMenuId, setMoveMenuId] = useState(null)

  // Mark as Lost modal state
  const [lostModal, setLostModal] = useState(null) // lead object
  const [lostReason, setLostReason] = useState('')
  const [lostCustom, setLostCustom] = useState('')
  const [markingLost, setMarkingLost] = useState(false)
  const [selectedLead, setSelectedLead] = useState(null)
  const now = new Date()
  const [period, setPeriod] = useState({ mode: 'all', month: now.getMonth(), year: now.getFullYear() })

  useEffect(() => { fetchLeads() }, [])

  useEffect(() => {
    function handleClick(e) {
      if (!e.target.closest('.pipeline-card-actions')) {
        setMoveMenuId(null)
      }
    }
    if (moveMenuId) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [moveMenuId])

  async function fetchLeads() {
    const { data } = await supabase
      .from('leads')
      .select('*')
      .not('current_stage', 'eq', 'Disqualified')
      .eq('is_lost', false)
      .order('created_at', { ascending: false })

    if (data) setLeads(data)
    setLoading(false)
  }

  const filteredLeads = filterByPeriod(leads, period)

  const leadsByStage = {}
  PIPELINE_STAGES.forEach(s => { leadsByStage[s.key] = [] })
  filteredLeads.forEach(l => {
    if (leadsByStage[l.current_stage]) {
      leadsByStage[l.current_stage].push(l)
    }
  })

  const activeCount = filteredLeads.length

  // ── Drag and drop ──
  function handleDragStart(e, lead) {
    setDraggedLead(lead)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', lead.id)
  }

  function handleDragOver(e, stageKey) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverStage(stageKey)
  }

  function handleDragLeave() { setDragOverStage(null) }

  async function handleDrop(e, targetStage) {
    e.preventDefault()
    setDragOverStage(null)
    if (!draggedLead || draggedLead.current_stage === targetStage) {
      setDraggedLead(null)
      return
    }
    await moveLead(draggedLead, targetStage)
    setDraggedLead(null)
  }

  function handleDragEnd() {
    setDraggedLead(null)
    setDragOverStage(null)
  }

  async function moveLead(lead, targetStage) {
    setLeads(prev =>
      prev.map(l => l.id === lead.id ? { ...l, current_stage: targetStage } : l)
    )
    await supabase.from('leads').update({ current_stage: targetStage }).eq('id', lead.id)
    await supabase.from('lead_stage_history').insert({
      lead_id: lead.id, stage: targetStage, moved_by: profile?.id,
    })
    setMoveMenuId(null)
  }

  // ── Mark as Lost ──
  function openLostModal(lead) {
    setLostModal(lead)
    setLostReason('')
    setLostCustom('')
    setMoveMenuId(null)
  }

  async function handleMarkLost() {
    if (!lostModal) return
    const reason = lostReason === '__custom' ? lostCustom.trim() : lostReason
    if (!reason) return

    setMarkingLost(true)
    try {
      await supabase
        .from('leads')
        .update({ is_lost: true, lost_reason: reason })
        .eq('id', lostModal.id)

      await supabase.from('lead_stage_history').insert({
        lead_id: lostModal.id, stage: 'Lost', moved_by: profile?.id,
      })

      // Remove from local state
      setLeads(prev => prev.filter(l => l.id !== lostModal.id))
      setLostModal(null)
    } catch (err) {
      console.error('Error marking lead as lost:', err)
    } finally {
      setMarkingLost(false)
    }
  }

  function badgeClass(c) { return `badge badge-${c}` }

  function formatDate(lead) {
    if (lead.scheduled_day && lead.scheduled_time) {
      return `${lead.scheduled_day} · ${lead.scheduled_time}`
    }
    return null
  }

  // Gap 3: Lead aging — calculate days in current stage
  function getDaysInStage(lead) {
    // Use stage_entered_at if available, otherwise fall back to updated_at or created_at
    const ref = lead.stage_entered_at || lead.updated_at || lead.created_at
    if (!ref) return 0
    return Math.floor((Date.now() - new Date(ref).getTime()) / 86400000)
  }

  function getAgingClass(days) {
    if (days >= 10) return 'aging-red'
    if (days >= 5) return 'aging-amber'
    return ''
  }

  if (loading) {
    return (
      <div>
        <div className="page-header pipeline-header">
          <h1 className="page-title">Pipeline</h1>
        </div>
        <div className="pipeline-board">
          {[1,2,3,4,5].map(i => (
            <div key={i} className="pipeline-column">
              <div className="pipeline-column-header">
                <div className="skeleton" style={{ width: 80, height: 14 }} />
              </div>
              <div className="pipeline-column-cards">
                {i <= 2 && <div className="skeleton" style={{ height: 90, borderRadius: 'var(--radius-md)' }} />}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header pipeline-header">
        <div>
          <h1 className="page-title">Pipeline</h1>
          <p className="page-subtitle">{activeCount} active lead{activeCount !== 1 ? 's' : ''}</p>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      <div className="pipeline-board">
        {PIPELINE_STAGES.map((stage, stageIdx) => {
          const stageLeads = leadsByStage[stage.key]
          const isDropTarget = dragOverStage === stage.key && draggedLead?.current_stage !== stage.key
          return (
            <div
              key={stage.key}
              className={`pipeline-column ${isDropTarget ? 'drop-target' : ''}`}
              onDragOver={e => handleDragOver(e, stage.key)}
              onDragLeave={handleDragLeave}
              onDrop={e => handleDrop(e, stage.key)}
            >
              <div className="pipeline-column-header">
                <div className="pipeline-column-header-left">
                  <span className="pipeline-column-number">{stageIdx + 1}</span>
                  <span className="pipeline-column-title">{stage.label}</span>
                </div>
                {stageLeads.length > 0 && (
                  <span className="pipeline-column-count">{stageLeads.length}</span>
                )}
              </div>
              <div className="pipeline-column-cards">
                {stageLeads.length === 0 && (
                  <div className="pipeline-column-empty">No leads</div>
                )}
                {stageLeads.map(lead => {
                  const scheduleInfo = formatDate(lead)
                  return (
                    <div
                      key={lead.id}
                      className={`pipeline-card ${draggedLead?.id === lead.id ? 'dragging' : ''}`}
                      draggable
                      onDragStart={e => handleDragStart(e, lead)}
                      onDragEnd={handleDragEnd}
                    >
                      <div className="pipeline-card-top">
                        <div>
                          <div className="pipeline-card-name pipeline-card-name-link" onClick={() => setSelectedLead(lead)}>{lead.full_name}</div>
                          <div className="pipeline-card-company">{lead.company_name}</div>
                        </div>
                        <div className="pipeline-card-actions">
                          <button
                            className="pipeline-card-move-btn"
                            onClick={() => setMoveMenuId(moveMenuId === lead.id ? null : lead.id)}
                            aria-label="Lead actions"
                            title="Actions"
                          >
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                              <circle cx="8" cy="3" r="1.5" />
                              <circle cx="8" cy="8" r="1.5" />
                              <circle cx="8" cy="13" r="1.5" />
                            </svg>
                          </button>
                          {moveMenuId === lead.id && (
                            <div className="pipeline-move-menu">
                              <div className="pipeline-move-menu-title">Move to</div>
                              {PIPELINE_STAGES.filter(s => s.key !== lead.current_stage).map(s => (
                                <button
                                  key={s.key}
                                  className="pipeline-move-menu-item"
                                  onClick={() => moveLead(lead, s.key)}
                                >
                                  {s.label}
                                </button>
                              ))}
                              <div className="pipeline-move-menu-divider" />
                              <button
                                className="pipeline-move-menu-item pipeline-move-menu-lost"
                                onClick={() => openLostModal(lead)}
                              >
                                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                                  <circle cx="7" cy="7" r="5.5" />
                                  <path d="M5 5l4 4M9 5l-4 4" />
                                </svg>
                                Mark as Lost
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                      {scheduleInfo && (
                        <div className="pipeline-card-schedule">
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
                            <circle cx="6" cy="6" r="5" />
                            <path d="M6 3v3l2 1.5" />
                          </svg>
                          {scheduleInfo}
                        </div>
                      )}
                      <div className="pipeline-card-footer">
                        <span className={badgeClass(lead.classification)}>
                          {lead.classification.charAt(0).toUpperCase() + lead.classification.slice(1)}
                        </span>
                        <div className="pipeline-card-footer-right">
                          {(() => {
                            const days = getDaysInStage(lead)
                            const agingClass = getAgingClass(days)
                            return days > 0 ? (
                              <span className={`pipeline-card-aging ${agingClass}`} title={`${days} day${days !== 1 ? 's' : ''} in this stage`}>
                                {days}d
                              </span>
                            ) : null
                          })()}
                          <span className="pipeline-card-score">{lead.total_score}/21</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Mark as Lost Modal ── */}
      {lostModal && (
        <div className="modal-overlay" onClick={() => !markingLost && setLostModal(null)}>
          <div className="modal-card modal-lost" onClick={e => e.stopPropagation()}>
            <div className="modal-lost-header">
              <div className="modal-lost-icon">
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <circle cx="11" cy="11" r="9" />
                  <path d="M8 8l6 6M14 8l-6 6" />
                </svg>
              </div>
              <h3 className="modal-title">Mark Lead as Lost</h3>
            </div>
            <p className="modal-subtitle">
              <strong>{lostModal.full_name}</strong> from {lostModal.company_name} will be
              removed from the pipeline. This can be reversed from the All Leads view.
            </p>

            <div className="form-group">
              <label className="form-label">Reason for losing this lead</label>
              <div className="lost-reason-options">
                {LOST_REASONS.map(reason => (
                  <button
                    key={reason}
                    className={`lost-reason-option ${lostReason === reason ? 'selected' : ''}`}
                    onClick={() => { setLostReason(reason); setLostCustom('') }}
                    type="button"
                  >
                    {reason}
                  </button>
                ))}
                <button
                  className={`lost-reason-option ${lostReason === '__custom' ? 'selected' : ''}`}
                  onClick={() => setLostReason('__custom')}
                  type="button"
                >
                  Other reason...
                </button>
              </div>
              {lostReason === '__custom' && (
                <textarea
                  className="form-input lost-custom-input"
                  placeholder="Describe why this lead was lost..."
                  value={lostCustom}
                  onChange={e => setLostCustom(e.target.value)}
                  rows={3}
                  autoFocus
                />
              )}
            </div>

            <div className="modal-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setLostModal(null)}
                disabled={markingLost}
              >
                Cancel
              </button>
              <button
                className="btn btn-lost"
                onClick={handleMarkLost}
                disabled={
                  markingLost ||
                  (!lostReason) ||
                  (lostReason === '__custom' && !lostCustom.trim())
                }
              >
                {markingLost ? 'Removing...' : 'Mark as Lost'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lead Detail Drawer */}
      {selectedLead && (
        <LeadDetail lead={selectedLead} onClose={() => setSelectedLead(null)} onLeadUpdated={(updated) => {
          setLeads(prev => updated.is_lost ? prev.filter(l => l.id !== updated.id) : prev.map(l => l.id === updated.id ? updated : l))
          setSelectedLead(null)
        }} />
      )}
    </div>
  )
}
