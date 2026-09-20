import { useState, useEffect, useMemo } from 'react'
import { DateTime } from 'luxon'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import '../Dashboard.css'
import './ContentLibrary.css'
import './ActivityInbox.css'

const EVENT_ICONS = {
  comment: '💬',
  reaction: '👍',
  mention: '📣',
  follower_milestone: '🎉',
}

const EVENT_LABELS = {
  comment: 'Comment',
  reaction: 'Reaction',
  mention: 'Mention',
  follower_milestone: 'Follower Milestone',
}

const MILESTONES = [100, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000]

export default function ActivityInbox() {
  const { profile } = useAuth()
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [triageFilter, setTriageFilter] = useState('needs_response')
  const [typeFilter, setTypeFilter] = useState('all')
  const [showLogModal, setShowLogModal] = useState(false)
  const [newEvent, setNewEvent] = useState({ event_type: 'comment', content: '', author_name: '', occurred_at: new Date().toISOString().slice(0, 16), external_url: '' })
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState({ show: false, type: '', text: '' })

  useEffect(() => { fetchEvents() }, [])

  useEffect(() => {
    if (toast.show) {
      const t = setTimeout(() => setToast({ show: false, type: '', text: '' }), 4000)
      return () => clearTimeout(t)
    }
  }, [toast.show])

  function showToast(type, text) { setToast({ show: true, type, text }) }

  async function fetchEvents() {
    setLoading(true)
    const { data } = await supabase.from('activity_events').select('*, posts(caption)').order('occurred_at', { ascending: false }).limit(200)
    if (data) setEvents(data)
    setLoading(false)
  }

  const filtered = useMemo(() => events.filter(e => {
    if (triageFilter !== 'all' && e.triage_status !== triageFilter) return false
    if (typeFilter !== 'all' && e.event_type !== typeFilter) return false
    return true
  }), [events, triageFilter, typeFilter])

  // Spike flag: 3+ comments in the last hour is treated as unusual activity worth surfacing first.
  const spikePostIds = useMemo(() => {
    const oneHourAgo = Date.now() - 60 * 60 * 1000
    const counts = {}
    events.filter(e => e.event_type === 'comment' && new Date(e.occurred_at).getTime() >= oneHourAgo).forEach(e => {
      if (!e.post_id) return
      counts[e.post_id] = (counts[e.post_id] || 0) + 1
    })
    return new Set(Object.entries(counts).filter(([, c]) => c >= 3).map(([id]) => id))
  }, [events])

  async function updateTriage(id, status) {
    await supabase.from('activity_events').update({ triage_status: status }).eq('id', id)
    setEvents(prev => prev.map(e => e.id === id ? { ...e, triage_status: status } : e))
  }

  async function handleLogEvent() {
    if (!newEvent.content && newEvent.event_type !== 'follower_milestone') {
      showToast('error', 'Add a description')
      return
    }
    setSaving(true)
    const { data: account } = await supabase.from('connected_accounts').select('id, account_name').eq('platform', 'linkedin').maybeSingle()

    const payload = {
      account_id: account?.id || null,
      event_type: newEvent.event_type,
      content: newEvent.content.trim() || null,
      author_name: newEvent.author_name.trim() || null,
      occurred_at: new Date(newEvent.occurred_at).toISOString(),
      external_url: newEvent.external_url.trim() || null,
      created_by: profile?.id,
    }
    const { error } = await supabase.from('activity_events').insert(payload)
    setSaving(false)
    if (error) { showToast('error', 'Failed to log activity'); return }

    // Follower milestone check — alert the team if the logged count crosses one of the standard thresholds.
    if (newEvent.event_type === 'follower_milestone' && newEvent.content) {
      const count = Number(newEvent.content)
      const crossed = MILESTONES.find(m => count >= m && count - m < 50)
      if (crossed) {
        supabase.functions.invoke('sm-notify-event', {
          body: { event: 'follower_milestone', milestone: crossed, current_count: count, account_name: account?.account_name },
        }).catch(() => {})
      }
    }

    showToast('success', 'Activity logged')
    setShowLogModal(false)
    setNewEvent({ event_type: 'comment', content: '', author_name: '', occurred_at: new Date().toISOString().slice(0, 16), external_url: '' })
    fetchEvents()
  }

  if (loading) {
    return (
      <div>
        <div className="page-header"><h1 className="page-title">Activity Inbox</h1></div>
        <div className="skeleton skeleton-card" style={{ height: 300 }} />
      </div>
    )
  }

  return (
    <div>
      <div className="page-header dash-header">
        <div>
          <h1 className="page-title">Activity Inbox</h1>
          <p className="page-subtitle">{events.filter(e => e.triage_status === 'needs_response').length} need a response</p>
        </div>
        <div className="dash-header-actions">
          <button className="btn btn-primary btn-sm" onClick={() => setShowLogModal(true)}>Log Activity</button>
        </div>
      </div>

      <div className="ai-filters">
        <div className="lib-type-pills">
          {[{ key: 'needs_response', label: 'Needs Response' }, { key: 'handled', label: 'Handled' }, { key: 'ignored', label: 'Ignored' }, { key: 'all', label: 'All' }].map(f => (
            <button key={f.key} className={`lib-type-pill ${triageFilter === f.key ? 'active' : ''}`} onClick={() => setTriageFilter(f.key)}>{f.label}</button>
          ))}
        </div>
        <select className="form-input form-input-sm" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="all">All Types</option>
          {Object.entries(EVENT_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="section-card"><div className="empty-state"><p className="empty-state-desc">Nothing here.</p></div></div>
      ) : (
        <div className="ai-feed">
          {filtered.map(event => {
            const isSpike = event.post_id && spikePostIds.has(event.post_id)
            return (
              <div key={event.id} className={`ai-item ${isSpike ? 'ai-item-spike' : ''}`}>
                <span className="ai-item-icon">{EVENT_ICONS[event.event_type]}</span>
                <div className="ai-item-body">
                  <div className="ai-item-top">
                    <span className="ai-item-type">{EVENT_LABELS[event.event_type]}</span>
                    {isSpike && <span className="status-badge status-changes_requested">Spike</span>}
                    <span className="ai-item-time">{DateTime.fromISO(event.occurred_at).toRelative()}</span>
                  </div>
                  {event.author_name && <div className="ai-item-author">{event.author_name}</div>}
                  {event.content && <div className="ai-item-content">{event.content}</div>}
                  {event.posts?.caption && <div className="ai-item-post-ref">on: {event.posts.caption.slice(0, 60)}</div>}
                  <div className="ai-item-actions">
                    {event.external_url && <a href={event.external_url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">Reply on LinkedIn</a>}
                    {event.triage_status !== 'handled' && <button className="btn btn-secondary btn-sm" onClick={() => updateTriage(event.id, 'handled')}>Mark Handled</button>}
                    {event.triage_status !== 'ignored' && <button className="btn btn-secondary btn-sm" onClick={() => updateTriage(event.id, 'ignored')}>Ignore</button>}
                    {event.triage_status !== 'needs_response' && <button className="btn btn-secondary btn-sm" onClick={() => updateTriage(event.id, 'needs_response')}>Reopen</button>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showLogModal && (
        <div className="modal-overlay" onClick={() => !saving && setShowLogModal(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Log Activity</h3>
            <p className="modal-subtitle">No API access yet — log what you see on LinkedIn directly here.</p>
            <div className="form-group">
              <label className="form-label">Type</label>
              <select className="form-input" value={newEvent.event_type} onChange={e => setNewEvent(prev => ({ ...prev, event_type: e.target.value }))}>
                {Object.entries(EVENT_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            {newEvent.event_type === 'follower_milestone' ? (
              <div className="form-group">
                <label className="form-label">Current follower count</label>
                <input type="number" className="form-input" value={newEvent.content} onChange={e => setNewEvent(prev => ({ ...prev, content: e.target.value }))} />
              </div>
            ) : (
              <>
                <div className="form-group">
                  <label className="form-label">From</label>
                  <input className="form-input" value={newEvent.author_name} onChange={e => setNewEvent(prev => ({ ...prev, author_name: e.target.value }))} placeholder="Name on LinkedIn" />
                </div>
                <div className="form-group">
                  <label className="form-label">Content</label>
                  <textarea className="form-input" rows={3} value={newEvent.content} onChange={e => setNewEvent(prev => ({ ...prev, content: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Link to LinkedIn (optional)</label>
                  <input className="form-input" value={newEvent.external_url} onChange={e => setNewEvent(prev => ({ ...prev, external_url: e.target.value }))} placeholder="https://www.linkedin.com/..." />
                </div>
              </>
            )}
            <div className="form-group">
              <label className="form-label">When</label>
              <input type="datetime-local" className="form-input" value={newEvent.occurred_at} onChange={e => setNewEvent(prev => ({ ...prev, occurred_at: e.target.value }))} />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowLogModal(false)} disabled={saving}>Cancel</button>
              <button className="btn btn-primary" onClick={handleLogEvent} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {toast.show && <div className={`toast toast-${toast.type}`}>{toast.text}</div>}
    </div>
  )
}
