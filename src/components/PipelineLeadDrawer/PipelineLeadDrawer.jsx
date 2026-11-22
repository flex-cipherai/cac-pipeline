import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import {
  MEDIUMS, MEDIUM_BY_KEY, SOURCES, ENTRY_POINTS, INTERACTION_MEDIUMS, STALE_AFTER_HOURS,
  isStale, hoursQuiet, hoursUntilStale, timeAgo, money, initials,
} from '../../lib/pipeline'
import { LostModal } from './PipelineModals'
import './PipelineLeadDrawer.css'

const MEDIUM_ICONS = {
  phone_call: <path d="M3 2.5h2.5l1.2 3-1.6 1a7 7 0 0 0 3.4 3.4l1-1.6 3 1.2V12a1.5 1.5 0 0 1-1.5 1.5A10.5 10.5 0 0 1 1.5 4 1.5 1.5 0 0 1 3 2.5z" />,
  e_meeting: <><rect x="1.5" y="3.5" width="8.5" height="8" rx="1.5" /><path d="M10 6.5l3.5-2v6l-3.5-2" /></>,
  physical_meeting: <><circle cx="5" cy="5" r="2" /><circle cx="10.5" cy="5" r="2" /><path d="M1.5 12.5c.4-2 1.8-3 3.5-3s3.1 1 3.5 3M8 9.6c.7-.4 1.5-.6 2.5-.6 1.7 0 3.1 1 3.5 3" /></>,
  email: <><rect x="1.5" y="3" width="12" height="9" rx="1.5" /><path d="M1.5 4.5l6 4 6-4" /></>,
  whatsapp: <><path d="M7.5 1.5a6 6 0 0 0-5.2 9l-.8 3 3.1-.8A6 6 0 1 0 7.5 1.5z" /><path d="M5.3 5c.2 1.8 1.7 3.6 3.9 4.4l.9-.9" /></>,
  note: <><path d="M3 2h7l2.5 2.5V13H3z" /><path d="M5 7h5M5 9.5h3.5" /></>,
  stage: <path d="M2 7.5h9M8 4l3.5 3.5L8 11" />,
}

function Icon({ k, size = 15 }) {
  return <svg width={size} height={size} viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{MEDIUM_ICONS[k]}</svg>
}

// <input type="datetime-local"> wants local time without a zone.
function localInputValue(d = new Date()) {
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function waLink(phone) {
  const digits = String(phone || '').replace(/\D/g, '')
  return digits ? `https://wa.me/${digits}` : null
}

export default function PipelineLeadDrawer({ lead, team, canEdit, isAdmin, onClose, onChanged, onToast }) {
  const { profile } = useAuth()
  const [activities, setActivities] = useState([])
  const [loadingLog, setLoadingLog] = useState(true)
  const [medium, setMedium] = useState('phone_call')
  const [summary, setSummary] = useState('')
  const [nextStep, setNextStep] = useState('')
  const [when, setWhen] = useState(localInputValue())
  const [saving, setSaving] = useState(false)
  const [lostOpen, setLostOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(lead)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const now = new Date()

  useEffect(() => {
    let alive = true
    supabase.from('pipeline_activities').select('*, author:created_by(name)').eq('lead_id', lead.id).order('occurred_at', { ascending: false })
      .then(({ data }) => { if (alive) { setActivities(data || []); setLoadingLog(false) } })
    return () => { alive = false }
  }, [lead.id])

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !lostOpen) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, lostOpen])

  const stale = isStale(lead, now)
  const interactions = activities.filter(a => INTERACTION_MEDIUMS.includes(a.medium))

  async function logInteraction(e) {
    e.preventDefault()
    if (saving) return
    const occurred = when ? new Date(when) : new Date()
    if (occurred.getTime() > Date.now() + 5 * 60_000) { onToast({ type: 'error', text: 'An interaction cannot be in the future.' }); return }
    setSaving(true)
    const row = {
      lead_id: lead.id, medium, summary: summary.trim() || null, next_step: nextStep.trim() || null,
      occurred_at: occurred.toISOString(), created_by: profile?.id,
    }
    const { data, error } = await supabase.from('pipeline_activities').insert(row).select('*, author:created_by(name)').single()
    setSaving(false)
    if (error) { onToast({ type: 'error', text: `Not logged: ${error.message}` }); return }
    setActivities(prev => [data, ...prev].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)))
    setSummary(''); setNextStep(''); setWhen(localInputValue())
    if (INTERACTION_MEDIUMS.includes(medium)) {
      const last = lead.last_interaction_at && lead.last_interaction_at > data.occurred_at ? lead.last_interaction_at : data.occurred_at
      onChanged({ ...lead, last_interaction_at: last }, { lead_id: lead.id, medium, occurred_at: data.occurred_at })
      onToast({ type: 'success', text: `${MEDIUM_BY_KEY[medium].label} logged` })
    } else {
      onToast({ type: 'success', text: 'Note added' })
    }
  }

  async function update(patch, message) {
    const { data, error } = await supabase.from('pipeline_leads').update(patch).eq('id', lead.id).select('*').single()
    if (error) { onToast({ type: 'error', text: error.message }); return null }
    onChanged(data)
    if (message) onToast({ type: 'success', text: message })
    return data
  }

  async function setStage(stage, extra = {}) {
    const data = await update({ stage, ...extra })
    if (!data) return
    const text = stage === 'client' ? 'Marked as a client' : stage === 'lost' ? `Marked as lost${extra.lost_reason ? `: ${extra.lost_reason}` : ''}` : 'Reopened as an active lead'
    const { data: act } = await supabase.from('pipeline_activities')
      .insert({ lead_id: lead.id, medium: 'stage', summary: text, created_by: profile?.id }).select('*, author:created_by(name)').single()
    if (act) setActivities(prev => [act, ...prev])
    onToast({ type: 'success', text: stage === 'client' ? `${lead.full_name} is now a client 🎉` : text })
  }

  async function saveDetails(e) {
    e.preventDefault()
    if (!draft.full_name?.trim()) { onToast({ type: 'error', text: 'A lead needs a name.' }); return }
    const value = draft.estimated_value === '' || draft.estimated_value == null ? null : Number(draft.estimated_value)
    const data = await update({
      full_name: draft.full_name.trim(), company_name: draft.company_name?.trim() || null, email: draft.email?.trim() || null,
      phone: draft.phone?.trim() || null, role_title: draft.role_title?.trim() || null, source_channel: draft.source_channel,
      estimated_value: Number.isFinite(value) ? value : null, currency: (draft.currency || 'KES').toUpperCase().slice(0, 3),
    }, 'Details saved')
    if (data) setEditing(false)
  }

  async function remove() {
    const { error } = await supabase.from('pipeline_leads').delete().eq('id', lead.id)
    if (error) { onToast({ type: 'error', text: error.message }); return }
    onToast({ type: 'success', text: `${lead.full_name} deleted` })
    onChanged(null)
  }

  const wa = waLink(lead.phone)
  const owner = team.find(t => t.id === lead.owner_id)

  return (
    <>
      <div className="lead-detail-overlay" onClick={onClose} aria-hidden="true" />
      <aside className="pld" role="dialog" aria-modal="true" aria-label={`Lead: ${lead.full_name}`}>
        <header className="pld-head">
          <div className="pld-identity">
            <span className={`pld-avatar ${lead.stage === 'client' ? 'is-won' : ''}`} aria-hidden="true">{initials(lead.full_name)}</span>
            <div>
              <h2 className="pld-name">{lead.full_name}</h2>
              <p className="pld-sub">{[lead.role_title, lead.company_name].filter(Boolean).join(' · ') || 'No company given'}</p>
            </div>
          </div>
          <button type="button" className="lead-detail-close" onClick={onClose} aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M14 6L6 14M6 6l8 8" /></svg>
          </button>
        </header>

        <div className="pld-meta">
          <span className={`pld-stage pld-stage-${lead.stage}`}>{lead.stage === 'active' ? 'Active lead' : lead.stage === 'client' ? 'Client' : 'Lost'}</span>
          <span className="pld-meta-item">{ENTRY_POINTS[lead.entry_point]}</span>
          <span className="pld-meta-item">{SOURCES.find(s => s.key === lead.source_channel)?.label}</span>
          <span className="pld-meta-item">Arrived {timeAgo(lead.created_at, now)}</span>
        </div>

        <div className="pld-contact">
          {lead.phone && <a className="pld-contact-btn" href={`tel:${lead.phone}`}><Icon k="phone_call" />Call</a>}
          {wa && <a className="pld-contact-btn" href={wa} target="_blank" rel="noopener noreferrer"><Icon k="whatsapp" />WhatsApp</a>}
          {lead.email && <a className="pld-contact-btn" href={`mailto:${lead.email}`}><Icon k="email" />Email</a>}
          {lead.assessment_id && <Link className="pld-contact-btn" to={`/assessments?id=${lead.assessment_id}`}><Icon k="note" />Scoper report</Link>}
        </div>

        {lead.stage === 'active' && (
          stale ? (
            <div className="pld-banner pld-banner-stale" role="status">
              <strong>{Math.floor(hoursQuiet(lead, now))} hours with no logged interaction.</strong> The admins have been alerted. Log your next call, meeting, email or WhatsApp below.
            </div>
          ) : (
            <div className="pld-banner">
              {lead.last_interaction_at ? `Last interaction ${timeAgo(lead.last_interaction_at, now)}.` : 'Not contacted yet.'} Flagged if nothing is logged in the next {Math.ceil(hoursUntilStale(lead, now))} hours.
            </div>
          )
        )}

        <div className="pld-body">
          {/* Log an interaction */}
          {canEdit && lead.stage !== 'lost' && (
            <form className="pld-log" onSubmit={logInteraction}>
              <p className="pld-section-title">Log an interaction</p>
              <div className="pld-mediums" role="radiogroup" aria-label="Medium">
                {[...MEDIUMS, { key: 'note', label: 'Note' }].map(m => (
                  <button key={m.key} type="button" role="radio" aria-checked={medium === m.key}
                    className={`pld-medium ${medium === m.key ? 'active' : ''} ${m.key === 'note' ? 'pld-medium-note' : ''}`}
                    onClick={() => setMedium(m.key)}>
                    <Icon k={m.key} />{m.label}
                  </button>
                ))}
              </div>
              <textarea className="form-input pld-textarea" rows={3} value={summary} onChange={e => setSummary(e.target.value)}
                placeholder={medium === 'note' ? 'Write a note (does not count as an interaction)' : 'What was discussed? What did they say?'} maxLength={4000} />
              <div className="pld-log-row">
                <input className="form-input" value={nextStep} onChange={e => setNextStep(e.target.value)} placeholder="Next step (optional)" maxLength={300} aria-label="Next step" />
                <input className="form-input pld-when" type="datetime-local" value={when} max={localInputValue()} onChange={e => setWhen(e.target.value)} aria-label="When" />
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Logging…' : medium === 'note' ? 'Add note' : 'Log'}</button>
              </div>
              {medium === 'note' && <p className="pld-hint">Notes stay on the timeline but do not reset the {STALE_AFTER_HOURS}-hour clock.</p>}
            </form>
          )}

          {/* Timeline */}
          <section>
            <p className="pld-section-title">Activity <span className="pld-count">{interactions.length} interaction{interactions.length === 1 ? '' : 's'}</span></p>
            {loadingLog ? <p className="pld-muted">Loading…</p> : activities.length === 0 ? (
              <p className="pld-muted">Nothing logged yet.</p>
            ) : (
              <ol className="pld-timeline">
                {activities.map(a => (
                  <li key={a.id} className={`pld-event pld-event-${a.medium}`}>
                    <span className="pld-event-icon"><Icon k={a.medium} size={13} /></span>
                    <div className="pld-event-body">
                      <div className="pld-event-head">
                        <strong>{MEDIUM_BY_KEY[a.medium]?.label}</strong>
                        <span>{new Date(a.occurred_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{a.author?.name ? ` · ${a.author.name}` : ''}</span>
                      </div>
                      {a.summary && <p>{a.summary}</p>}
                      {a.next_step && <p className="pld-next">Next: {a.next_step}</p>}
                    </div>
                  </li>
                ))}
                <li className="pld-event pld-event-stage">
                  <span className="pld-event-icon"><Icon k="stage" size={13} /></span>
                  <div className="pld-event-body">
                    <div className="pld-event-head"><strong>Became a lead</strong><span>{new Date(lead.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></div>
                    <p>{ENTRY_POINTS[lead.entry_point]}{lead.source_detail ? ` · ${lead.source_detail}` : ''}</p>
                  </div>
                </li>
              </ol>
            )}
          </section>

          {/* What they asked */}
          {lead.summary && (
            <section>
              <p className="pld-section-title">What they asked for</p>
              <pre className="pld-summary">{lead.summary}</pre>
            </section>
          )}

          {/* Details */}
          <section>
            <div className="pld-section-row">
              <p className="pld-section-title">Details</p>
              {canEdit && !editing && <button type="button" className="pld-link" onClick={() => { setDraft(lead); setEditing(true) }}>Edit</button>}
            </div>
            {editing ? (
              <form className="pld-form" onSubmit={saveDetails}>
                {[['full_name', 'Name'], ['company_name', 'Company'], ['role_title', 'Role'], ['email', 'Email'], ['phone', 'Phone']].map(([k, label]) => (
                  <label key={k} className="pld-field"><span>{label}</span><input className="form-input" value={draft[k] || ''} onChange={e => setDraft({ ...draft, [k]: e.target.value })} /></label>
                ))}
                <label className="pld-field"><span>Source</span>
                  <select className="form-input" value={draft.source_channel} onChange={e => setDraft({ ...draft, source_channel: e.target.value })}>
                    {SOURCES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </label>
                <label className="pld-field"><span>Estimated value</span>
                  <span className="pld-money">
                    <input className="form-input" value={draft.currency || 'KES'} onChange={e => setDraft({ ...draft, currency: e.target.value })} maxLength={3} aria-label="Currency" />
                    <input className="form-input" type="number" min="0" step="1000" value={draft.estimated_value ?? ''} onChange={e => setDraft({ ...draft, estimated_value: e.target.value })} aria-label="Amount" />
                  </span>
                </label>
                <div className="pld-form-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Save</button>
                </div>
              </form>
            ) : (
              <dl className="pld-dl">
                <dt>Owner</dt>
                <dd>
                  {canEdit ? (
                    <select className="form-input form-input-sm" value={lead.owner_id || ''} onChange={e => update({ owner_id: e.target.value || null }, 'Owner updated')} aria-label="Owner">
                      <option value="">No owner</option>
                      {team.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  ) : (owner?.name || 'No owner')}
                </dd>
                <dt>Email</dt><dd>{lead.email || '—'}</dd>
                <dt>Phone</dt><dd>{lead.phone || '—'}</dd>
                {lead.website_url && <><dt>Website</dt><dd><a href={lead.website_url} target="_blank" rel="noopener noreferrer">{lead.website_url.replace(/^https?:\/\//, '')}</a></dd></>}
                <dt>Estimated value</dt><dd>{lead.estimated_value ? money(lead.estimated_value, lead.currency) : '—'}</dd>
                {(lead.staff_band || lead.sector) && <><dt>Business</dt><dd>{[lead.staff_band && `${lead.staff_band} staff`, lead.sector].filter(Boolean).join(' · ')}</dd></>}
                {(lead.utm_campaign || lead.referrer) && <><dt>Campaign</dt><dd>{[lead.utm_source, lead.utm_medium, lead.utm_campaign].filter(Boolean).join(' / ') || lead.referrer}</dd></>}
                {lead.won_at && <><dt>Won</dt><dd>{new Date(lead.won_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</dd></>}
              </dl>
            )}
          </section>
        </div>

        {canEdit && (
          <footer className="pld-foot">
            {lead.stage === 'active' && (
              <>
                <button type="button" className="btn btn-secondary" onClick={() => setLostOpen(true)}>Mark as lost</button>
                <button type="button" className="btn btn-primary" onClick={() => setStage('client')}>Mark as client</button>
              </>
            )}
            {lead.stage !== 'active' && <button type="button" className="btn btn-secondary" onClick={() => setStage('active')}>Reopen as active lead</button>}
            {isAdmin && (confirmDelete
              ? <span className="pld-confirm">Delete for good? <button type="button" className="pld-link pld-danger" onClick={remove}>Yes, delete</button> <button type="button" className="pld-link" onClick={() => setConfirmDelete(false)}>Cancel</button></span>
              : <button type="button" className="pld-link pld-danger pld-delete" onClick={() => setConfirmDelete(true)}>Delete</button>)}
          </footer>
        )}
      </aside>

      {lostOpen && <LostModal lead={lead} onClose={() => setLostOpen(false)} onConfirm={reason => { setLostOpen(false); setStage('lost', { lost_reason: reason }) }} />}
    </>
  )
}
