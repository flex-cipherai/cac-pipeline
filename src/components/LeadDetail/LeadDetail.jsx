import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { QUALIFICATION_QUESTIONS } from '../../lib/scoring'
import './LeadDetail.css'

export default function LeadDetail({ lead, onClose }) {
  const { profile } = useAuth()
  const [activeTab, setActiveTab] = useState('overview')
  const [notes, setNotes] = useState([])
  const [stageHistory, setStageHistory] = useState([])
  const [newNote, setNewNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [loadingData, setLoadingData] = useState(true)
  const textareaRef = useRef(null)

  useEffect(() => {
    if (lead) fetchLeadData()
  }, [lead?.id])

  // Close on escape
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  async function fetchLeadData() {
    setLoadingData(true)

    const [notesRes, historyRes] = await Promise.all([
      supabase
        .from('lead_notes')
        .select('*, profiles:created_by(name)')
        .eq('lead_id', lead.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('lead_stage_history')
        .select('*, profiles:moved_by(name)')
        .eq('lead_id', lead.id)
        .order('entered_at', { ascending: false }),
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
      .from('lead_notes')
      .insert({ lead_id: lead.id, note: newNote.trim(), created_by: profile?.id })
      .select('*, profiles:created_by(name)')
      .single()

    if (data && !error) {
      setNotes(prev => [data, ...prev])
      setNewNote('')
    }
    setSaving(false)
  }

  function formatDate(dateStr) {
    if (!dateStr) return '—'
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  function formatTime(dateStr) {
    if (!dateStr) return ''
    const d = new Date(dateStr)
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  }

  function formatRelative(dateStr) {
    const d = new Date(dateStr)
    const now = new Date()
    const ms = now - d
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

  // Build qualification responses
  const qResponses = [
    { key: 'q1', label: 'Annual Revenue', value: lead.q1_revenue, score: lead.q1_score },
    { key: 'q2', label: 'Business Challenge', value: lead.q2_challenge, score: lead.q2_score },
    { key: 'q3', label: 'Role in Decision', value: lead.q3_role, score: lead.q3_score },
    { key: 'q4', label: 'Priority', value: lead.q4_priority, score: lead.q4_score },
    { key: 'q5', label: 'Timeline', value: lead.q5_timeline, score: lead.q5_score },
  ]

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
        </div>

        {/* Tabs */}
        <div className="lead-detail-tabs">
          {[
            { key: 'overview', label: 'Overview' },
            { key: 'responses', label: 'Responses' },
            { key: 'notes', label: `Notes${notes.length ? ` (${notes.length})` : ''}` },
            { key: 'history', label: 'History' },
          ].map(tab => (
            <button
              key={tab.key}
              className={`lead-detail-tab ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="lead-detail-body">
          {/* ── Overview ── */}
          {activeTab === 'overview' && (
            <div className="lead-detail-section">
              <div className="lead-detail-field-group">
                <div className="lead-detail-field">
                  <span className="lead-detail-field-label">Email</span>
                  <span className="lead-detail-field-value">{lead.email}</span>
                </div>
                <div className="lead-detail-field">
                  <span className="lead-detail-field-label">Phone</span>
                  <span className="lead-detail-field-value">{lead.phone}</span>
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
            </div>
          )}

          {/* ── Qualification Responses ── */}
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

          {/* ── Notes ── */}
          {activeTab === 'notes' && (
            <div className="lead-detail-section">
              {/* Add note form */}
              <form className="lead-detail-note-form" onSubmit={handleAddNote}>
                <textarea
                  ref={textareaRef}
                  className="lead-detail-note-input"
                  placeholder="Add a note about this lead..."
                  value={newNote}
                  onChange={e => setNewNote(e.target.value)}
                  rows={3}
                />
                <div className="lead-detail-note-form-actions">
                  <button type="submit" className="btn btn-primary btn-sm" disabled={saving || !newNote.trim()}>
                    {saving ? 'Saving...' : 'Add Note'}
                  </button>
                </div>
              </form>

              {/* Notes list */}
              {loadingData ? (
                <div className="skeleton skeleton-bar" style={{ marginTop: 16 }} />
              ) : notes.length === 0 ? (
                <div className="lead-detail-empty">
                  <p>No notes yet. Add the first note above.</p>
                </div>
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

          {/* ── Stage History ── */}
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
