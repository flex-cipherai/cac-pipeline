import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { PIPELINE_STAGES } from '../lib/scoring'
import './Pipeline.css'

export default function Pipeline() {
  const { profile } = useAuth()
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [draggedLead, setDraggedLead] = useState(null)
  const [dragOverStage, setDragOverStage] = useState(null)
  const [moveMenuId, setMoveMenuId] = useState(null)
  const moveMenuRef = useRef(null)

  useEffect(() => {
    fetchLeads()
  }, [])

  // Close move menu on outside click
  useEffect(() => {
    function handleClick(e) {
      if (moveMenuRef.current && !moveMenuRef.current.contains(e.target)) {
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

  const leadsByStage = {}
  PIPELINE_STAGES.forEach(s => { leadsByStage[s.key] = [] })
  leads.forEach(l => {
    if (leadsByStage[l.current_stage]) {
      leadsByStage[l.current_stage].push(l)
    }
  })

  const activeCount = leads.length

  // ── Drag and drop ──
  function handleDragStart(e, lead) {
    setDraggedLead(lead)
    e.dataTransfer.effectAllowed = 'move'
    // For a nice drag ghost
    e.dataTransfer.setData('text/plain', lead.id)
  }

  function handleDragOver(e, stageKey) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverStage(stageKey)
  }

  function handleDragLeave() {
    setDragOverStage(null)
  }

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

  // ── Move via menu (keyboard/mobile accessible) ──
  async function moveLead(lead, targetStage) {
    setLeads(prev =>
      prev.map(l =>
        l.id === lead.id ? { ...l, current_stage: targetStage } : l
      )
    )

    await supabase
      .from('leads')
      .update({ current_stage: targetStage })
      .eq('id', lead.id)

    await supabase.from('lead_stage_history').insert({
      lead_id: lead.id,
      stage: targetStage,
      moved_by: profile?.id,
    })

    setMoveMenuId(null)
  }

  function badgeClass(classification) {
    return `badge badge-${classification}`
  }

  // Format scheduled date
  function formatDate(lead) {
    if (lead.scheduled_day && lead.scheduled_time) {
      return `${lead.scheduled_day} · ${lead.scheduled_time}`
    }
    return null
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
        <h1 className="page-title">Pipeline</h1>
        <span className="pipeline-count">
          {activeCount} active lead{activeCount !== 1 ? 's' : ''}
        </span>
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
                  <div className="pipeline-column-empty">
                    No leads
                  </div>
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
                          <div className="pipeline-card-name">{lead.full_name}</div>
                          <div className="pipeline-card-company">{lead.company_name}</div>
                        </div>
                        {/* Move menu button — accessible alternative to drag */}
                        <div className="pipeline-card-actions" ref={moveMenuId === lead.id ? moveMenuRef : null}>
                          <button
                            className="pipeline-card-move-btn"
                            onClick={() => setMoveMenuId(moveMenuId === lead.id ? null : lead.id)}
                            aria-label="Move lead"
                            title="Move to stage"
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
                        <span className="pipeline-card-score">{lead.total_score}/21</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
