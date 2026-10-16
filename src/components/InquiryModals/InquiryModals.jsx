import { useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { PIPELINE_STAGES } from '../../lib/scoring'
import {
  CHANNELS, CLOSE_REASONS, channelLabel, channelLeadSource, closeReasonLabel,
  findMatches, toLocalInput, todayISO,
} from '../../lib/inquiries'
import './InquiryModals.css'

function MatchWarning({ matches }) {
  const count = matches.inquiries.length + matches.leads.length
  if (count === 0) return null
  return (
    <div className="inq-match-warning" role="status">
      <strong>This looks like someone we already have:</strong>
      <ul>
        {matches.leads.map(l => (
          <li key={l.id}>Lead: {l.full_name}{l.company_name ? `, ${l.company_name}` : ''} ({l.is_lost ? 'Lost' : l.current_stage})</li>
        ))}
        {matches.inquiries.map(i => (
          <li key={i.id}>Inquiry: {i.full_name}{i.company_name ? `, ${i.company_name}` : ''} ({i.status})</li>
        ))}
      </ul>
    </div>
  )
}

// ── Log a new inquiry ──

export function LogInquiryModal({ team, inquiries, leads, onClose, onSaved }) {
  const { profile } = useAuth()
  const [form, setForm] = useState(() => ({
    full_name: '', company_name: '', phone: '', email: '', has_whatsapp: true,
    channel: 'whatsapp', source_detail: '', message: '',
    received_at: toLocalInput(new Date()), assigned_to: profile?.id || '', next_follow_up: '', replied: false,
  }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = patch => setForm(f => ({ ...f, ...patch }))
  const matches = useMemo(
    () => findMatches({ email: form.email, phone: form.phone }, inquiries, leads),
    [form.email, form.phone, inquiries, leads],
  )

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!form.full_name.trim()) return setError('Enter a name.')
    if (!form.phone.trim() && !form.email.trim()) return setError('Enter a phone number or an email so the person can be reached.')

    const now = new Date().toISOString()
    const row = {
      full_name: form.full_name.trim(),
      company_name: form.company_name.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      has_whatsapp: form.has_whatsapp,
      channel: form.channel,
      source_detail: form.source_detail.trim() || null,
      message: form.message.trim() || null,
      received_at: new Date(form.received_at).toISOString(),
      assigned_to: form.assigned_to || null,
      next_follow_up: form.next_follow_up || null,
      created_by: profile?.id || null,
    }
    if (form.replied) Object.assign(row, { status: 'contacted', first_response_at: now, last_contact_at: now })

    setSaving(true)
    const { data, error: err } = await supabase.from('inquiries').insert(row).select().single()
    setSaving(false)
    if (err || !data) return setError(err?.message || 'Could not save the inquiry.')
    onSaved(data)
  }

  return (
    <div className="modal-overlay" onClick={() => !saving && onClose()}>
      <div className="modal-card modal-card-wide" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="inq-log-title">
        <h3 className="modal-title" id="inq-log-title">Log an inquiry</h3>
        <p className="modal-subtitle">Someone has reached out and isn't a lead yet. Capture it now so it gets followed up.</p>
        <form onSubmit={handleSubmit}>
          <div className="inq-form-grid">
            <div className="form-group">
              <label className="form-label">How did they reach out?</label>
              <select className="form-input" value={form.channel} onChange={e => set({ channel: e.target.value, ...(e.target.value === 'whatsapp' ? { has_whatsapp: true } : {}) })}>
                {CHANNELS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Received</label>
              <input className="form-input" type="datetime-local" required value={form.received_at} max={toLocalInput(new Date())} onChange={e => set({ received_at: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Name</label>
              <input className="form-input" required autoFocus value={form.full_name} onChange={e => set({ full_name: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Company <span className="inq-optional">(optional)</span></label>
              <input className="form-input" value={form.company_name} onChange={e => set({ company_name: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Phone</label>
              <input className="form-input" type="tel" value={form.phone} onChange={e => set({ phone: e.target.value })} placeholder="0712 345 678" />
            </div>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input className="form-input" type="email" value={form.email} onChange={e => set({ email: e.target.value })} />
            </div>
          </div>
          <p className="inq-field-hint">A phone number or an email is enough.</p>
          <label className="checkbox-label inq-check">
            <input type="checkbox" checked={form.has_whatsapp} onChange={e => set({ has_whatsapp: e.target.checked })} />
            Reachable on WhatsApp
          </label>

          <MatchWarning matches={matches} />

          <div className="form-group">
            <label className="form-label">What are they asking about?</label>
            <textarea className="form-input" rows={3} value={form.message} onChange={e => set({ message: e.target.value })} placeholder="In their words, if you have them" />
          </div>
          <div className="form-group">
            <label className="form-label">Referred by / campaign / event <span className="inq-optional">(optional)</span></label>
            <input className="form-input" value={form.source_detail} onChange={e => set({ source_detail: e.target.value })} />
          </div>
          <div className="inq-form-grid">
            <div className="form-group">
              <label className="form-label">Owner</label>
              <select className="form-input" value={form.assigned_to} onChange={e => set({ assigned_to: e.target.value })}>
                <option value="">Unassigned</option>
                {team.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Follow up on <span className="inq-optional">(optional)</span></label>
              <input className="form-input" type="date" min={todayISO()} value={form.next_follow_up} onChange={e => set({ next_follow_up: e.target.value })} />
            </div>
          </div>
          <label className="checkbox-label inq-check">
            <input type="checkbox" checked={form.replied} onChange={e => set({ replied: e.target.checked })} />
            We have already replied to them
          </label>

          {error && <p className="form-error inq-form-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Log inquiry'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Convert to a lead, or link to a lead that already exists ──

const CONVERT_STAGES = [
  { key: 'Incomplete', label: 'No call booked yet (Incomplete)' },
  ...PIPELINE_STAGES.filter(s => s.key !== 'Converted').map(s => ({ key: s.key, label: s.label })),
]

export function ConvertInquiryModal({ inquiry, inquiries, leads, onClose, onConverted }) {
  const { profile } = useAuth()
  const matches = useMemo(
    () => findMatches({ email: inquiry.email, phone: inquiry.phone }, inquiries, leads, inquiry.id),
    [inquiry, inquiries, leads],
  )
  const [mode, setMode] = useState(matches.leads.length > 0 ? 'link' : 'new')
  const [form, setForm] = useState({
    full_name: inquiry.full_name || '',
    company_name: inquiry.company_name || '',
    email: inquiry.email || '',
    phone: inquiry.phone || '',
    has_whatsapp: !!inquiry.has_whatsapp,
    classification: 'unscored',
    stage: CONVERT_STAGES[0].key,
    source: channelLeadSource(inquiry.channel),
  })
  const [linkId, setLinkId] = useState(matches.leads[0]?.id || '')
  const [leadSearch, setLeadSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = patch => setForm(f => ({ ...f, ...patch }))

  const leadChoices = useMemo(() => {
    const q = leadSearch.trim().toLowerCase()
    const matchIds = new Set(matches.leads.map(l => l.id))
    return leads
      .filter(l => !q || `${l.full_name} ${l.company_name} ${l.email}`.toLowerCase().includes(q))
      .sort((a, b) => Number(matchIds.has(b.id)) - Number(matchIds.has(a.id)))
      .slice(0, 8)
  }, [leads, leadSearch, matches])

  async function convertToNewLead() {
    const missing = ['full_name', 'company_name', 'email', 'phone'].filter(k => !form[k].trim())
    if (missing.length) return setError('A lead needs a name, company, email and phone. Fill in the missing details.')
    setSaving(true)
    const { data: leadId, error: err } = await supabase.rpc('convert_inquiry_to_lead', {
      p_inquiry_id: inquiry.id,
      p_full_name: form.full_name.trim(),
      p_company_name: form.company_name.trim(),
      p_email: form.email.trim(),
      p_phone: form.phone.trim(),
      p_has_whatsapp: form.has_whatsapp,
      p_classification: form.classification,
      p_stage: form.stage,
      p_source: form.source.trim(),
    })
    if (err || !leadId) {
      setSaving(false)
      return setError(err?.message || 'Could not create the lead.')
    }
    // Same team alert as a lead added by hand on All Leads. A failure here must not undo the conversion.
    supabase.functions.invoke('notify-lead', { body: { lead_id: leadId, team_only: true } })
      .catch(e => console.error('[Email] notify-lead invoke failed:', e))
    await onConverted(leadId, `${form.full_name.trim()} is now a lead`)
  }

  async function linkToExistingLead() {
    const lead = leads.find(l => l.id === linkId)
    if (!lead) return setError('Choose the lead this inquiry belongs to.')
    setSaving(true)
    const { error: err } = await supabase.from('inquiries').update({
      status: 'converted', lead_id: lead.id, converted_at: new Date().toISOString(),
      closed_at: null, close_reason: null, next_follow_up: null,
    }).eq('id', inquiry.id)
    if (err) {
      setSaving(false)
      return setError(err.message || 'Could not link the inquiry.')
    }
    await supabase.from('inquiry_activities').insert({
      inquiry_id: inquiry.id, kind: 'status', created_by: profile?.id || null,
      body: `Linked to existing lead ${lead.full_name}${lead.company_name ? ` (${lead.company_name})` : ''}`,
    })
    await onConverted(lead.id, `Linked to ${lead.full_name}`)
  }

  function handleSubmit(e) {
    e.preventDefault()
    setError('')
    return mode === 'new' ? convertToNewLead() : linkToExistingLead()
  }

  return (
    <div className="modal-overlay" onClick={() => !saving && onClose()}>
      <div className="modal-card modal-card-wide" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="inq-convert-title">
        <h3 className="modal-title" id="inq-convert-title">Turn {inquiry.full_name} into a lead</h3>
        <p className="modal-subtitle">
          From {channelLabel(inquiry.channel)}. The inquiry is marked converted and keeps its history.
        </p>

        {matches.leads.length > 0 && (
          <div className="inq-match-warning" role="status">
            <strong>A lead with the same {matches.leads.some(l => l.email && l.email.toLowerCase() === (inquiry.email || '').toLowerCase()) ? 'email' : 'phone number'} already exists.</strong>
            {' '}Link to it instead of creating a duplicate.
          </div>
        )}

        <div className="inq-mode-switch" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'new'} className={mode === 'new' ? 'active' : ''} onClick={() => { setMode('new'); setError('') }}>Create a new lead</button>
          <button type="button" role="tab" aria-selected={mode === 'link'} className={mode === 'link' ? 'active' : ''} onClick={() => { setMode('link'); setError('') }}>Link to an existing lead</button>
        </div>

        <form onSubmit={handleSubmit}>
          {mode === 'new' ? (
            <>
              <div className="inq-form-grid">
                <div className="form-group">
                  <label className="form-label">Name</label>
                  <input className="form-input" required value={form.full_name} onChange={e => set({ full_name: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Company</label>
                  <input className="form-input" required value={form.company_name} onChange={e => set({ company_name: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input className="form-input" type="email" required value={form.email} onChange={e => set({ email: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Phone</label>
                  <input className="form-input" type="tel" required value={form.phone} onChange={e => set({ phone: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Starts at stage</label>
                  <select className="form-input" value={form.stage} onChange={e => set({ stage: e.target.value })}>
                    {CONVERT_STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Classification</label>
                  <select className="form-input" value={form.classification} onChange={e => set({ classification: e.target.value })}>
                    <option value="unscored">Not scored yet</option>
                    <option value="hot">Hot</option>
                    <option value="warm">Warm</option>
                    <option value="cold">Cold</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Lead source</label>
                <input className="form-input" required value={form.source} onChange={e => set({ source: e.target.value })} />
              </div>
              <label className="checkbox-label inq-check">
                <input type="checkbox" checked={form.has_whatsapp} onChange={e => set({ has_whatsapp: e.target.checked })} />
                Reachable on WhatsApp
              </label>
              <p className="inq-field-hint">
                The automatic "finish booking your call" email is switched off for this lead, because your team is already in touch.
                What they asked about is copied to the lead's notes.
              </p>
            </>
          ) : (
            <>
              <div className="form-group">
                <label className="form-label">Find the lead</label>
                <input className="form-input" placeholder="Search by name, company or email" value={leadSearch} onChange={e => setLeadSearch(e.target.value)} />
              </div>
              {leadChoices.length === 0 ? (
                <p className="inq-field-hint">No leads match.</p>
              ) : (
                <div className="inq-lead-choices" role="radiogroup" aria-label="Existing leads">
                  {leadChoices.map(l => (
                    <label key={l.id} className={`inq-lead-choice ${linkId === l.id ? 'selected' : ''}`}>
                      <input type="radio" name="inq-link-lead" checked={linkId === l.id} onChange={() => setLinkId(l.id)} />
                      <span>
                        <strong>{l.full_name}</strong>{l.company_name ? `, ${l.company_name}` : ''}
                        <small>{l.email} · {l.is_lost ? 'Lost' : l.current_stage}{matches.leads.some(m => m.id === l.id) ? ' · same contact details' : ''}</small>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </>
          )}

          {error && <p className="form-error inq-form-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : mode === 'new' ? 'Create lead' : 'Link to lead'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Close without a lead ──

export function CloseInquiryModal({ inquiry, onClose, onClosed }) {
  const { profile } = useAuth()
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!reason) return setError('Pick a reason so the closed inquiries tell us something.')
    setSaving(true)
    setError('')
    const { error: err } = await supabase.from('inquiries').update({
      status: 'closed', close_reason: reason, closed_at: new Date().toISOString(), next_follow_up: null,
    }).eq('id', inquiry.id)
    if (err) {
      setSaving(false)
      return setError(err.message || 'Could not close the inquiry.')
    }
    await supabase.from('inquiry_activities').insert({
      inquiry_id: inquiry.id, kind: 'status', created_by: profile?.id || null,
      body: `Closed: ${closeReasonLabel(reason)}${note.trim() ? `. ${note.trim()}` : ''}`,
    })
    await onClosed(`${inquiry.full_name} closed`)
  }

  return (
    <div className="modal-overlay" onClick={() => !saving && onClose()}>
      <div className="modal-card" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="inq-close-title">
        <h3 className="modal-title" id="inq-close-title">Close this inquiry</h3>
        <p className="modal-subtitle">{inquiry.full_name} won't become a lead. You can reopen it later if they come back.</p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Why is it closing?</label>
            <select className="form-input" value={reason} onChange={e => setReason(e.target.value)} autoFocus>
              <option value="">Choose a reason...</option>
              {CLOSE_REASONS.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Note <span className="inq-optional">(optional)</span></label>
            <textarea className="form-input" rows={2} value={note} onChange={e => setNote(e.target.value)} />
          </div>
          {error && <p className="form-error inq-form-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Closing...' : 'Close inquiry'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
