import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { PIPELINE_STAGES } from '../lib/scoring'
import './Pipeline.css'

export default function Pipeline() {
  const { profile } = useAuth()
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [draggedLead, setDraggedLead] = useState(null)

  useEffect(() => {
    fetchLeads()
  }, [])

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

  // Group leads by stage
  const leadsByStage = {}
  PIPELINE_STAGES.forEach(s => { leadsByStage[s.key] = [] })
  leads.forEach(l => {
    if (leadsByStage[l.current_stage]) {
      leadsByStage[l.current_stage].push(l)
    }
  })

  const activeCount = leads.length

  // Drag and drop
  function handleDragStart(e, lead) {
    setDraggedLead(lead)
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDragOver(e) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  async function handleDrop(e, targetStage) {
    e.preventDefault()
    if (!draggedLead || draggedLead.current_stage === targetStage) {
      setDraggedLead(null)
      return
    }

    // Optimistic update
    setLeads(prev =>
      prev.map(l =>
        l.id === draggedLead.id ? { ...l, current_stage: targetStage } : l
      )
    )

    // Update in database
    await supabase
      .from('leads')
      .update({ current_stage: targetStage })
      .eq('id', draggedLead.id)

    // Record stage history
    await supabase.from('lead_stage_history').insert({
      lead_id: draggedLead.id,
      stage: targetStage,
      moved_by: profile?.id,
    })

    setDraggedLead(null)
  }

  // Classification badge class
  function badgeClass(classification) {
    return `badge badge-${classification}`
  }

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Pipeline</h1>
        </div>
        <p style={{ color: 'var(--text-secondary)' }}>Loading...</p>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header pipeline-header">
        <h1 className="page-title">Pipeline</h1>
        <span className="pipeline-count">{activeCount} active lead{activeCount !== 1 ? 's' : ''}</span>
      </div>

      <div className="pipeline-board">
        {PIPELINE_STAGES.map(stage => {
          const stageLeads = leadsByStage[stage.key]
          return (
            <div
              key={stage.key}
              className="pipeline-column"
              onDragOver={handleDragOver}
              onDrop={e => handleDrop(e, stage.key)}
            >
              <div className="pipeline-column-header">
                <span className="pipeline-column-title">{stage.label}</span>
                {stageLeads.length > 0 && (
                  <span className="pipeline-column-count">{stageLeads.length}</span>
                )}
              </div>
              <div className="pipeline-column-cards">
                {stageLeads.map(lead => (
                  <div
                    key={lead.id}
                    className="pipeline-card"
                    draggable
                    onDragStart={e => handleDragStart(e, lead)}
                  >
                    <div className="pipeline-card-name">{lead.full_name}</div>
                    <div className="pipeline-card-company">{lead.company_name}</div>
                    <div className="pipeline-card-footer">
                      <span className={badgeClass(lead.classification)}>
                        {lead.classification.charAt(0).toUpperCase() + lead.classification.slice(1)}
                      </span>
                      <span className="pipeline-card-score">{lead.total_score}/21</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
