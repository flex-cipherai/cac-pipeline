import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { SOURCES, LOST_REASONS } from '../../lib/pipeline'

// Staff add a lead they met elsewhere (a referral, an event, a cold reply). It starts at stage 2.
export function AddLeadModal({ team, onClose, onSaved }) {
  const { profile } = useAuth()
  const [f, setF] = useState({ full_name: '', company_name: '', email: '', phone: '', role_title: '', source_channel: 'other', source_detail: '', summary: '', owner_id: profile?.id || '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }))

  async function submit(e) {
    e.preventDefault()
    if (!f.full_name.trim()) { setError('Enter their name.'); return }
    if (!f.email.trim() && !f.phone.trim()) { setError('Add an email or a phone number so the team can reach them.'); return }
    setSaving(true); setError('')
    // Same person already in the pipeline? Say so instead of creating a duplicate.
    const email = f.email.trim().toLowerCase()
    if (email) {
      const { data: dup } = await supabase.from('pipeline_leads').select('id, full_name, stage').ilike('email', email).limit(1)
      if (dup?.length) { setSaving(false); setError(`${dup[0].full_name} is already in the pipeline with this email (${dup[0].stage}).`); return }
    }
    const { data, error: err } = await supabase.from('pipeline_leads').insert({
      service_line: 'custom_build', stage: 'active', entry_point: 'manual',
      full_name: f.full_name.trim(), company_name: f.company_name.trim() || null, email: email || null, phone: f.phone.trim() || null,
      role_title: f.role_title.trim() || null, source_channel: f.source_channel, source_detail: f.source_detail.trim() || null,
      summary: f.summary.trim() || null, owner_id: f.owner_id || null, created_by: profile?.id,
    }).select('*').single()
    setSaving(false)
    if (err) { setError(err.message); return }
    onSaved(data)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal-card modal-card-wide" onClick={e => e.stopPropagation()} onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="add-lead-title">
        <h2 className="modal-title" id="add-lead-title">Add a lead</h2>
        <p className="modal-subtitle">Someone you met outside the website. They start as an active lead; log your first interaction within 48 hours.</p>
        <div className="pl-form-grid">
          <label className="form-group"><span className="form-label">Name *</span><input className="form-input" value={f.full_name} onChange={e => set('full_name', e.target.value)} autoFocus /></label>
          <label className="form-group"><span className="form-label">Company</span><input className="form-input" value={f.company_name} onChange={e => set('company_name', e.target.value)} /></label>
          <label className="form-group"><span className="form-label">Email</span><input className="form-input" type="email" value={f.email} onChange={e => set('email', e.target.value)} /></label>
          <label className="form-group"><span className="form-label">Phone / WhatsApp</span><input className="form-input" type="tel" value={f.phone} onChange={e => set('phone', e.target.value)} placeholder="+254…" /></label>
          <label className="form-group"><span className="form-label">Role</span><input className="form-input" value={f.role_title} onChange={e => set('role_title', e.target.value)} /></label>
          <label className="form-group"><span className="form-label">Source</span>
            <select className="form-input" value={f.source_channel} onChange={e => set('source_channel', e.target.value)}>
              {SOURCES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
          <label className="form-group"><span className="form-label">Source detail</span><input className="form-input" value={f.source_detail} onChange={e => set('source_detail', e.target.value)} placeholder="Who referred them, which post, which event" /></label>
          <label className="form-group"><span className="form-label">Owner</span>
            <select className="form-input" value={f.owner_id} onChange={e => set('owner_id', e.target.value)}>
              <option value="">No owner</option>
              {team.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="form-group pl-form-full"><span className="form-label">What do they want built?</span><textarea className="form-input" rows={3} value={f.summary} onChange={e => set('summary', e.target.value)} /></label>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Adding…' : 'Add lead'}</button>
        </div>
      </form>
    </div>
  )
}

export function LostModal({ lead, onClose, onConfirm }) {
  const [reason, setReason] = useState('')
  const [other, setOther] = useState('')
  const final = reason === 'Other' ? other.trim() || 'Other' : reason
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="lost-title">
        <h2 className="modal-title" id="lost-title">Mark {lead.full_name} as lost</h2>
        <p className="modal-subtitle">They leave the board but stay on record. You can reopen them later.</p>
        <div className="pl-reasons" role="radiogroup">
          {LOST_REASONS.map(r => (
            <label key={r} className={`pl-reason ${reason === r ? 'active' : ''}`}>
              <input type="radio" name="lost" value={r} checked={reason === r} onChange={() => setReason(r)} />{r}
            </label>
          ))}
        </div>
        {reason === 'Other' && <input className="form-input" style={{ marginTop: 10 }} value={other} onChange={e => setOther(e.target.value)} placeholder="What happened?" autoFocus />}
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-danger" disabled={!reason} onClick={() => onConfirm(final)}>Mark as lost</button>
        </div>
      </div>
    </div>
  )
}
