import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { whatsappUrl } from '../../lib/scoring'
import {
  ACTIVITY_KINDS, OPEN_STATUSES, STATUSES, activityLabel, attentionReasons, channelLabel, closeReasonLabel,
  formatMinutes, isOpen, minutesToFirstReply, shortDateTime, shortDay, statusLabel, timeAgo, todayISO,
} from '../../lib/inquiries'
import '../LeadDetail/LeadDetail.css'
import './InquiryDetail.css'

const LOGGABLE = ACTIVITY_KINDS.filter(k => k.key !== 'status')

export default function InquiryDetail({ inquiry, team, leads, canDelete, onClose, onChanged, onConvert, onCloseInquiry, onDelete }) {
  const { profile } = useAuth()
  const [tab, setTab] = useState('overview')
  const [activities, setActivities] = useState([])
  const [loadingActivities, setLoadingActivities] = useState(true)
  const [kind, setKind] = useState('note')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [followUp, setFollowUp] = useState(inquiry.next_follow_up || '')
  const [error, setError] = useState('')

  useEffect(() => { loadActivities() }, [inquiry.id])
  useEffect(() => { setFollowUp(inquiry.next_follow_up || '') }, [inquiry.id, inquiry.next_follow_up])
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  async function loadActivities() {
    setLoadingActivities(true)
    const { data } = await supabase
      .from('inquiry_activities')
      .select('*, profiles:created_by(name)')
      .eq('inquiry_id', inquiry.id)
      .order('created_at', { ascending: false })
    setActivities(data || [])
    setLoadingActivities(false)
  }

  // The database stamps first reply / last contact / status when a touch is logged, so read the row back.
  async function reloadInquiry() {
    const { data } = await supabase.from('inquiries').select('*').eq('id', inquiry.id).single()
    if (data) onChanged(data)
  }

  async function addActivity(activityKind, text) {
    const { error: err } = await supabase.from('inquiry_activities').insert({
      inquiry_id: inquiry.id, kind: activityKind, body: text, created_by: profile?.id || null,
    })
    if (err) throw err
  }

  async function handleLog(e) {
    e.preventDefault()
    if (!body.trim()) return
    setSaving(true)
    setError('')
    try {
      await addActivity(kind, body.trim())
      setBody('')
      await Promise.all([loadActivities(), reloadInquiry()])
    } catch (err) {
      setError(err.message || 'Could not save.')
    }
    setSaving(false)
  }

  async function patchInquiry(patch) {
    setError('')
    const { data, error: err } = await supabase.from('inquiries').update(patch).eq('id', inquiry.id).select().single()
    if (err || !data) {
      setError(err?.message || 'Could not save the change.')
      return null
    }
    onChanged(data)
    return data
  }

  async function handleStatusChange(next) {
    if (next === inquiry.status) return
    const patch = { status: next }
    // Moving off "new" by hand is a reply too, so the response-time report is not left blank.
    if (inquiry.status === 'new' && !inquiry.first_response_at) {
      const now = new Date().toISOString()
      patch.first_response_at = now
      patch.last_contact_at = now
    }
    const saved = await patchInquiry(patch)
    if (saved) {
      await addActivity('status', `Status: ${statusLabel(inquiry.status)} to ${statusLabel(next)}`).catch(() => {})
      loadActivities()
    }
  }

  async function handleReopen() {
    const next = inquiry.first_response_at ? 'contacted' : 'new'
    const saved = await patchInquiry({ status: next, close_reason: null, closed_at: null })
    if (saved) {
      await addActivity('status', `Reopened as ${statusLabel(next)}`).catch(() => {})
      loadActivities()
    }
  }

  const open = isOpen(inquiry)
  const reasons = attentionReasons(inquiry)
  const lead = inquiry.lead_id ? leads.find(l => l.id === inquiry.lead_id) : null
  const owner = team.find(t => t.id === inquiry.assigned_to)
  const waHref = whatsappUrl(inquiry.phone, `Hi ${String(inquiry.full_name || '').split(' ')[0]}, this is SDFM Group. Thanks for reaching out.`)

  return (
    <>
      <div className="lead-detail-overlay" onClick={onClose} />
      <div className="lead-detail-drawer" role="dialog" aria-modal="true" aria-label={`Inquiry from ${inquiry.full_name}`}>
        <div className="lead-detail-header">
          <div className="lead-detail-header-top">
            <button className="lead-detail-close" onClick={onClose} aria-label="Close">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M14 6L6 14M6 6l8 8" /></svg>
            </button>
          </div>
          <div className="lead-detail-identity">
            <div className="lead-detail-avatar">{inquiry.full_name?.charAt(0).toUpperCase()}</div>
            <div>
              <h2 className="lead-detail-name">{inquiry.full_name}</h2>
              <p className="lead-detail-company">{inquiry.company_name || 'Company not known yet'}</p>
            </div>
          </div>
          <div className="lead-detail-meta-row">
            <span className={`inq-status inq-status-${inquiry.status}`}>{statusLabel(inquiry.status)}</span>
            <span className="inq-channel-tag">{channelLabel(inquiry.channel)}</span>
            {reasons.map(r => <span key={r} className="inq-attention">{r}</span>)}
          </div>

          <div className="lead-detail-contact-actions">
            {inquiry.email && (
              <a href={`mailto:${inquiry.email}`} className="lead-detail-contact-btn" title={`Email ${inquiry.email}`}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><rect x="1" y="3" width="12" height="8" rx="1.5" /><path d="M1 4.5l6 4 6-4" /></svg>
                Email
              </a>
            )}
            {inquiry.phone && (
              <a href={`tel:${inquiry.phone}`} className="lead-detail-contact-btn" title={`Call ${inquiry.phone}`}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><path d="M5.2 2.5l-1.8-.3a1 1 0 0 0-1.1.7l-.3 1.2A9 9 0 0 0 10 12l1.2-.3a1 1 0 0 0 .7-1.1l-.3-1.8-2.3-.6-1 1.3a7 7 0 0 1-3.8-3.8L5.8 4.8z" /></svg>
                Call
              </a>
            )}
            {waHref && (inquiry.has_whatsapp || inquiry.channel === 'whatsapp') && (
              <a href={waHref} target="_blank" rel="noopener noreferrer" className="lead-detail-contact-btn lead-detail-contact-wa" title="WhatsApp">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M7 1A6 6 0 0 0 1.7 10L1 13l3.1-.7A6 6 0 1 0 7 1zm3.2 8.5c-.1.4-.8.7-1.1.8-.3 0-.6.1-2-.4A7.3 7.3 0 0 1 4.2 7c-.6-.7-.9-1.5-.9-2.2 0-.7.3-1 .4-1.2.1-.1.3-.2.4-.2h.3c.1 0 .3 0 .4.3s.5 1.3.6 1.4c.1.1 0 .3-.1.4l-.3.3c-.1.1-.2.2-.1.4.1.2.6 1 1.2 1.6.8.7 1.5 1 1.7 1 .2.1.3 0 .5-.1l.5-.6c.2-.2.3-.2.5-.1l1.4.7c.2.1.3.2.4.3 0 .1 0 .5-.2.9z" /></svg>
                WhatsApp
              </a>
            )}
          </div>

          <div className="inq-header-actions">
            {open && <button className="btn btn-primary btn-sm" onClick={() => onConvert(inquiry)}>Turn into a lead</button>}
            {open && <button className="btn btn-secondary btn-sm" onClick={() => onCloseInquiry(inquiry)}>Close</button>}
            {inquiry.status === 'closed' && <button className="btn btn-secondary btn-sm" onClick={handleReopen}>Reopen</button>}
          </div>
        </div>

        <div className="lead-detail-tabs">
          {[
            { key: 'overview', label: 'Overview' },
            { key: 'activity', label: `Activity${activities.length ? ` (${activities.length})` : ''}` },
          ].map(t => (
            <button key={t.key} className={`lead-detail-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>

        <div className="lead-detail-body">
          {error && <p className="form-error inq-detail-error">{error}</p>}

          {tab === 'overview' && (
            <div className="lead-detail-section">
              {inquiry.status === 'converted' && (
                <div className="inq-converted-card">
                  <strong>Became a lead</strong>
                  <span>
                    {lead ? `${lead.full_name}${lead.company_name ? `, ${lead.company_name}` : ''} (${lead.is_lost ? 'Lost' : lead.current_stage})` : 'The lead has since been removed.'}
                  </span>
                  <small>Open All Leads to work it in the pipeline.</small>
                </div>
              )}

              {inquiry.message && (
                <div className="inq-message">
                  <span className="lead-detail-field-label">What they asked</span>
                  <p>{inquiry.message}</p>
                </div>
              )}

              <div className="lead-detail-field-group">
                {open && (
                  <div className="lead-detail-field">
                    <span className="lead-detail-field-label">Status</span>
                    <select className="form-input inq-inline-select" value={inquiry.status} onChange={e => handleStatusChange(e.target.value)} aria-label="Status">
                      {STATUSES.filter(s => OPEN_STATUSES.includes(s.key)).map(s => <option key={s.key} value={s.key}>{s.label}: {s.hint}</option>)}
                    </select>
                  </div>
                )}
                <div className="lead-detail-field">
                  <span className="lead-detail-field-label">Owner</span>
                  {inquiry.status === 'converted' || inquiry.status === 'closed' ? (
                    <span className="lead-detail-field-value">{owner?.name || 'Unassigned'}</span>
                  ) : (
                    <select className="form-input inq-inline-select" value={inquiry.assigned_to || ''} onChange={e => patchInquiry({ assigned_to: e.target.value || null })} aria-label="Owner">
                      <option value="">Unassigned</option>
                      {team.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  )}
                </div>
                {inquiry.email && (
                  <div className="lead-detail-field">
                    <span className="lead-detail-field-label">Email</span>
                    <span className="lead-detail-field-value">{inquiry.email}</span>
                  </div>
                )}
                {inquiry.phone && (
                  <div className="lead-detail-field">
                    <span className="lead-detail-field-label">Phone</span>
                    <span className="lead-detail-field-value">{inquiry.phone} {inquiry.has_whatsapp && <span className="lead-detail-wa-tag">WhatsApp</span>}</span>
                  </div>
                )}
                <div className="lead-detail-field">
                  <span className="lead-detail-field-label">Came in via</span>
                  <span className="lead-detail-field-value">{channelLabel(inquiry.channel)}{inquiry.source_detail ? `, ${inquiry.source_detail}` : ''}</span>
                </div>
                <div className="lead-detail-field">
                  <span className="lead-detail-field-label">Received</span>
                  <span className="lead-detail-field-value">{shortDateTime(inquiry.received_at)}</span>
                </div>
                <div className="lead-detail-field">
                  <span className="lead-detail-field-label">First reply</span>
                  <span className="lead-detail-field-value">
                    {inquiry.first_response_at ? `${formatMinutes(minutesToFirstReply(inquiry))} after it came in` : 'Not replied yet'}
                  </span>
                </div>
                <div className="lead-detail-field">
                  <span className="lead-detail-field-label">Last contact</span>
                  <span className="lead-detail-field-value">{inquiry.last_contact_at ? timeAgo(inquiry.last_contact_at) : '—'}</span>
                </div>
                {inquiry.status === 'closed' && (
                  <div className="lead-detail-field">
                    <span className="lead-detail-field-label">Closed because</span>
                    <span className="lead-detail-field-value lead-detail-field-lost">{closeReasonLabel(inquiry.close_reason) || '—'}</span>
                  </div>
                )}
              </div>

              {open && (
                <div className="lead-detail-followup">
                  <div className="lead-detail-followup-header">
                    <span className="lead-detail-field-label">Follow-up date</span>
                    {reasons.includes('Follow-up due') && <span className="lead-detail-followup-overdue">Due</span>}
                  </div>
                  <div className="lead-detail-followup-row">
                    <input type="date" className="form-input lead-detail-followup-input" min={todayISO()} value={followUp} onChange={e => setFollowUp(e.target.value)} />
                    <button className="btn btn-primary btn-sm" onClick={() => patchInquiry({ next_follow_up: followUp || null })} disabled={(followUp || null) === inquiry.next_follow_up}>Set</button>
                    {inquiry.next_follow_up && <button className="btn btn-secondary btn-sm" onClick={() => { setFollowUp(''); patchInquiry({ next_follow_up: null }) }}>Clear</button>}
                  </div>
                  {inquiry.next_follow_up && <p className="inq-field-note">Next follow-up: {shortDay(inquiry.next_follow_up)}</p>}
                </div>
              )}

              {canDelete && (
                <button className="inq-delete-link" onClick={() => onDelete(inquiry)}>Delete this inquiry</button>
              )}
            </div>
          )}

          {tab === 'activity' && (
            <div className="lead-detail-section">
              <form className="lead-detail-note-form" onSubmit={handleLog}>
                <div className="inq-kind-picker" role="radiogroup" aria-label="Type of activity">
                  {LOGGABLE.map(k => (
                    <button key={k.key} type="button" role="radio" aria-checked={kind === k.key} className={kind === k.key ? 'active' : ''} onClick={() => setKind(k.key)}>{k.label}</button>
                  ))}
                </div>
                <textarea
                  className="lead-detail-note-input"
                  rows={3}
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  placeholder={kind === 'note' ? 'Add a note about this inquiry...' : `What was said on the ${activityLabel(kind).toLowerCase()}?`}
                />
                <div className="lead-detail-note-form-actions">
                  <button type="submit" className="btn btn-primary btn-sm" disabled={saving || !body.trim()}>{saving ? 'Saving...' : `Log ${activityLabel(kind).toLowerCase()}`}</button>
                </div>
              </form>

              {loadingActivities ? (
                <div className="skeleton skeleton-bar" style={{ marginTop: 16 }} />
              ) : activities.length === 0 ? (
                <div className="lead-detail-empty"><p>Nothing logged yet. Log your first call, message or note above.</p></div>
              ) : (
                <div className="lead-detail-timeline inq-timeline">
                  {activities.map((a, idx) => (
                    <div key={a.id} className={`lead-detail-timeline-item ${idx === 0 ? 'latest' : ''}`}>
                      <div className="lead-detail-timeline-dot" />
                      <div className="lead-detail-timeline-content">
                        <span className="lead-detail-timeline-stage">{activityLabel(a.kind)}</span>
                        {a.body && <p className="inq-activity-body">{a.body}</p>}
                        <span className="lead-detail-timeline-meta">
                          {shortDateTime(a.created_at)}{a.profiles?.name && ` · ${a.profiles.name}`}
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
