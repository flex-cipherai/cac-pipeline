import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { QUALIFICATION_QUESTIONS, PIPELINE_STAGES } from '../../lib/scoring'
import './LeadDetail.css'

export default function LeadDetail({ lead, onClose, onLeadUpdated }) {
  const { profile } = useAuth()
  const [activeTab, setActiveTab] = useState('overview')
  const [notes, setNotes] = useState([])
  const [stageHistory, setStageHistory] = useState([])
  const [newNote, setNewNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [loadingData, setLoadingData] = useState(true)
  const [followUpDate, setFollowUpDate] = useState(lead?.follow_up_date || '')
  const [savingFollowUp, setSavingFollowUp] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const textareaRef = useRef(null)

  useEffect(() => {
    if (lead) {
      fetchLeadData()
      setFollowUpDate(lead.follow_up_date || '')
    }
  }, [lead?.id])

  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  async function fetchLeadData() {
    setLoadingData(true)
    const [notesRes, historyRes] = await Promise.all([
      supabase.from('lead_notes').select('*, profiles:created_by(name)').eq('lead_id', lead.id).order('created_at', { ascending: false }),
      supabase.from('lead_stage_history').select('*, profiles:moved_by(name)').eq('lead_id', lead.id).order('entered_at', { ascending: false }),
    ])
    if (notesRes.data) setNotes(notesRes.data)
    if (historyRes.data) setStageHistory(historyRes.data)
    setLoadingData(false)
  }

  async function handleAddNote(e) {
    e.preventDefault()
    if (!newNote.trim()) return
    setSaving(true)
    const { data, error } = await supabase
      .from('lead_notes').insert({ lead_id: lead.id, note: newNote.trim(), created_by: profile?.id })
      .select('*, profiles:created_by(name)').single()
    if (data && !error) { setNotes(prev => [data, ...prev]); setNewNote('') }
    setSaving(false)
  }

  // Gap 4: Follow-up reminders
  async function handleSaveFollowUp() {
    setSavingFollowUp(true)
    const value = followUpDate || null
    await supabase.from('leads').update({ follow_up_date: value }).eq('id', lead.id)
    setSavingFollowUp(false)
    if (onLeadUpdated) onLeadUpdated({ ...lead, follow_up_date: value })
  }

  async function handleClearFollowUp() {
    setFollowUpDate('')
    setSavingFollowUp(true)
    await supabase.from('leads').update({ follow_up_date: null }).eq('id', lead.id)
    setSavingFollowUp(false)
    if (onLeadUpdated) onLeadUpdated({ ...lead, follow_up_date: null })
  }

  // Gap 5: Restore lost leads
  async function handleRestore() {
    setRestoring(true)
    // Find the last non-Lost stage from history
    const lastStage = stageHistory.find(h => h.stage !== 'Lost')
    const restoreTo = lastStage ? lastStage.stage : PIPELINE_STAGES[0].key

    await supabase.from('leads').update({ is_lost: false, lost_reason: null, current_stage: restoreTo }).eq('id', lead.id)
    await supabase.from('lead_stage_history').insert({ lead_id: lead.id, stage: restoreTo, moved_by: profile?.id })
    setRestoring(false)
    if (onLeadUpdated) onLeadUpdated({ ...lead, is_lost: false, lost_reason: null, current_stage: restoreTo })
    onClose()
  }

  function formatDate(dateStr) {
    if (!dateStr) return '—'
    return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  function formatTime(dateStr) {
    if (!dateStr) return ''
    return new Date(dateStr).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  }

  function formatRelative(dateStr) {
    const ms = Date.now() - new Date(dateStr)
    const mins = Math.floor(ms / 60000)
    const hrs = Math.floor(ms / 3600000)
    const days = Math.floor(ms / 86400000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins}m ago`
    if (hrs < 24) return `${hrs}h ago`
    if (days < 7) return `${days}d ago`
    return formatDate(dateStr)
  }

  if (!lead) return null

  const badgeClass = lead.is_disqualified ? 'badge badge-cold' : `badge badge-${lead.classification}`
  const classLabel = lead.is_disqualified ? 'Cold' : lead.classification.charAt(0).toUpperCase() + lead.classification.slice(1)

  const qResponses = [
    { key: 'q1', label: 'Annual Revenue', value: lead.q1_revenue, score: lead.q1_score },
    { key: 'q2', label: 'Business Challenge', value: lead.q2_challenge, score: lead.q2_score },
    { key: 'q3', label: 'Role in Decision', value: lead.q3_role, score: lead.q3_score },
    { key: 'q4', label: 'Priority', value: lead.q4_priority, score: lead.q4_score },
    { key: 'q5', label: 'Timeline', value: lead.q5_timeline, score: lead.q5_score },
  ]

  // Gap 4: follow-up status
  const followUpOverdue = followUpDate && new Date(followUpDate) < new Date(new Date().toDateString())

  return (
    <>
      <div className="lead-detail-overlay" onClick={onClose} />
      <div className="lead-detail-drawer" role="dialog" aria-modal="true">
        {/* Header */}
        <div className="lead-detail-header">
          <div className="lead-detail-header-top">
            <button className="lead-detail-close" onClick={onClose} aria-label="Close">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M14 6L6 14M6 6l8 8" /></svg>
            </button>
          </div>
          <div className="lead-detail-identity">
            <div className="lead-detail-avatar">{lead.full_name?.charAt(0).toUpperCase()}</div>
            <div>
              <h2 className="lead-detail-name">{lead.full_name}</h2>
              <p className="lead-detail-company">{lead.company_name}</p>
            </div>
          </div>
          <div className="lead-detail-meta-row">
            <span className={badgeClass}>{classLabel}</span>
            <span className="lead-detail-score">{lead.total_score}/21</span>
            {lead.is_lost && <span className="lead-detail-lost-tag">Lost</span>}
          </div>

          {/* Gap 6: Contact actions */}
          <div className="lead-detail-contact-actions">
            {lead.email && (
              <a href={`mailto:${lead.email}`} className="lead-detail-contact-btn" title={`Email ${lead.email}`}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><rect x="1" y="3" width="12" height="8" rx="1.5" /><path d="M1 4.5l6 4 6-4" /></svg>
                Email
              </a>
            )}
            {lead.phone && (
              <a href={`tel:${lead.phone}`} className="lead-detail-contact-btn" title={`Call ${lead.phone}`}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><path d="M5.2 2.5l-1.8-.3a1 1 0 0 0-1.1.7l-.3 1.2A9 9 0 0 0 10 12l1.2-.3a1 1 0 0 0 .7-1.1l-.3-1.8-2.3-.6-1 1.3a7 7 0 0 1-3.8-3.8L5.8 4.8z" /></svg>
                Call
              </a>
            )}
            {lead.phone && lead.has_whatsapp && (
              <a href={`https://wa.me/${lead.phone.replace(/[^0-9+]/g, '')}`} target="_blank" rel="noopener noreferrer" className="lead-detail-contact-btn lead-detail-contact-wa" title="WhatsApp">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M7 1A6 6 0 0 0 1.7 10L1 13l3.1-.7A6 6 0 1 0 7 1zm3.2 8.5c-.1.4-.8.7-1.1.8-.3 0-.6.1-2-.4A7.3 7.3 0 0 1 4.2 7c-.6-.7-.9-1.5-.9-2.2 0-.7.3-1 .4-1.2.1-.1.3-.2.4-.2h.3c.1 0 .3 0 .4.3s.5 1.3.6 1.4c.1.1 0 .3-.1.4l-.3.3c-.1.1-.2.2-.1.4.1.2.6 1 1.2 1.6.8.7 1.5 1 1.7 1 .2.1.3 0 .5-.1l.5-.6c.2-.2.3-.2.5-.1l1.4.7c.2.1.3.2.4.3 0 .1 0 .5-.2.9z" /></svg>
                WhatsApp
              </a>
            )}
          </div>

          {/* Gap 5: Restore lost lead */}
          {lead.is_lost && (
            <button className="lead-detail-restore-btn" onClick={handleRestore} disabled={restoring}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 7a5 5 0 0 1 9-3M12 7a5 5 0 0 1-9 3" /><path d="M2 3v4h4M12 11V7H8" /></svg>
              {restoring ? 'Restoring...' : 'Restore to Pipeline'}
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="lead-detail-tabs">
          {[
            { key: 'overview', label: 'Overview' },
            { key: 'responses', label: 'Responses' },
            { key: 'notes', label: `Notes${notes.length ? ` (${notes.length})` : ''}` },
            { key: 'history', label: 'History' },
          ].map(tab => (
            <button key={tab.key} className={`lead-detail-tab ${activeTab === tab.key ? 'active' : ''}`} onClick={() => setActiveTab(tab.key)}>{tab.label}</button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="lead-detail-body">
          {activeTab === 'overview' && (
            <div className="lead-detail-section">
              <div className="lead-detail-field-group">
                <div className="lead-detail-field">
                  <span className="lead-detail-field-label">Email</span>
                  <span className="lead-detail-field-value">{lead.email}</span>
                </div>
                <div className="lead-detail-field">
                  <span className="lead-detail-field-label">Phone</span>
                  <span className="lead-detail-field-value">{lead.phone} {lead.has_whatsapp && <span className="lead-detail-wa-tag">WhatsApp</span>}</span>
                </div>
                <div className="lead-detail-field">
                  <span className="lead-detail-field-label">Source</span>
                  <span className="lead-detail-field-value" style={{ textTransform: 'capitalize' }}>{lead.source}</span>
                </div>
                <div className="lead-detail-field">
                  <span className="lead-detail-field-label">Current Stage</span>
                  <span className="lead-detail-field-value">{lead.is_lost ? 'Lost' : lead.is_disqualified ? 'Disqualified' : lead.current_stage}</span>
                </div>
                {lead.scheduled_day && (
                  <div className="lead-detail-field">
                    <span className="lead-detail-field-label">Scheduled Call</span>
                    <span className="lead-detail-field-value">{lead.scheduled_day} at {lead.scheduled_time}</span>
                  </div>
                )}
                {lead.is_lost && lead.lost_reason && (
                  <div className="lead-detail-field">
                    <span className="lead-detail-field-label">Lost Reason</span>
                    <span className="lead-detail-field-value lead-detail-field-lost">{lead.lost_reason}</span>
                  </div>
                )}
                {lead.is_disqualified && lead.disqualifier_reason && (
                  <div className="lead-detail-field">
                    <span className="lead-detail-field-label">Disqualifier</span>
                    <span className="lead-detail-field-value lead-detail-field-lost">{lead.disqualifier_reason}</span>
                  </div>
                )}
                <div className="lead-detail-field">
                  <span className="lead-detail-field-label">Submitted</span>
                  <span className="lead-detail-field-value">{formatDate(lead.created_at)}</span>
                </div>
              </div>

              {/* Gap 4: Follow-up reminder */}
              {!lead.is_disqualified && (
                <div className="lead-detail-followup">
                  <div className="lead-detail-followup-header">
                    <span className="lead-detail-field-label">Follow-up Date</span>
                    {followUpOverdue && <span className="lead-detail-followup-overdue">Overdue</span>}
                  </div>
                  <div className="lead-detail-followup-row">
                    <input type="date" className="form-input lead-detail-followup-input" value={followUpDate} onChange={e => setFollowUpDate(e.target.value)} />
                    <button className="btn btn-primary btn-sm" onClick={handleSaveFollowUp} disabled={savingFollowUp}>{savingFollowUp ? '...' : 'Set'}</button>
                    {followUpDate && <button className="btn btn-secondary btn-sm" onClick={handleClearFollowUp}>Clear</button>}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'responses' && (
            <div className="lead-detail-section">
              <div className="lead-detail-responses">
                {qResponses.map((q, idx) => (
                  <div key={q.key} className="lead-detail-response">
                    <div className="lead-detail-response-header">
                      <span className="lead-detail-response-num">{idx + 1}</span>
                      <span className="lead-detail-response-label">{q.label}</span>
                      <span className="lead-detail-response-score">{q.score} pts</span>
                    </div>
                    <p className="lead-detail-response-value">{q.value || '—'}</p>
                  </div>
                ))}
                <div className="lead-detail-response-total">
                  <span>Total Score</span>
                  <span className="lead-detail-response-total-value">{lead.total_score}/21</span>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'notes' && (
            <div className="lead-detail-section">
              <form className="lead-detail-note-form" onSubmit={handleAddNote}>
                <textarea ref={textareaRef} className="lead-detail-note-input" placeholder="Add a note about this lead..." value={newNote} onChange={e => setNewNote(e.target.value)} rows={3} />
                <div className="lead-detail-note-form-actions">
                  <button type="submit" className="btn btn-primary btn-sm" disabled={saving || !newNote.trim()}>{saving ? 'Saving...' : 'Add Note'}</button>
                </div>
              </form>
              {loadingData ? (
                <div className="skeleton skeleton-bar" style={{ marginTop: 16 }} />
              ) : notes.length === 0 ? (
                <div className="lead-detail-empty"><p>No notes yet. Add the first note above.</p></div>
              ) : (
                <div className="lead-detail-notes-list">
                  {notes.map(note => (
                    <div key={note.id} className="lead-detail-note">
                      <div className="lead-detail-note-header">
                        <span className="lead-detail-note-author">{note.profiles?.name || 'Unknown'}</span>
                        <span className="lead-detail-note-time">{formatRelative(note.created_at)}</span>
                      </div>
                      <p className="lead-detail-note-text">{note.note}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'history' && (
            <div className="lead-detail-section">
              {loadingData ? (
                <div className="skeleton skeleton-bar" />
              ) : stageHistory.length === 0 ? (
                <div className="lead-detail-empty"><p>No stage history yet.</p></div>
              ) : (
                <div className="lead-detail-timeline">
                  {stageHistory.map((entry, idx) => (
                    <div key={entry.id} className={`lead-detail-timeline-item ${idx === 0 ? 'latest' : ''}`}>
                      <div className="lead-detail-timeline-dot" />
                      <div className="lead-detail-timeline-content">
                        <span className="lead-detail-timeline-stage">{entry.stage}</span>
                        <span className="lead-detail-timeline-meta">
                          {formatDate(entry.entered_at)} at {formatTime(entry.entered_at)}
                          {entry.profiles?.name && ` · by ${entry.profiles.name}`}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
