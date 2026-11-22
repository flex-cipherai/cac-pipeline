import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DateTime } from 'luxon'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { fetchAllAccounts } from '../../lib/socialAccounts'
import { AccountAvatar, SocialHeader, EmptyState } from '../../components/social/SocialUI'
import './Reports.css'

const SECTIONS = [
  ['overview', 'KPIs vs previous period'],
  ['top_posts', 'Top posts'],
  ['formats', 'Performance by format'],
  ['best_times', 'Best times to post'],
]
const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const blank = { name: '', account_ids: [], frequency: 'weekly', send_weekday: 1, recipients: [], sections: SECTIONS.map(s => s[0]), active: true }

// Scheduled reports (Metricool-style): branded email reports sent weekly or
// monthly by sm-reports. A download-anytime PDF lives in Analytics.
export default function Reports() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [schedules, setSchedules] = useState([])
  const [accounts, setAccounts] = useState([])
  const [editing, setEditing] = useState(null)
  const [recipientsText, setRecipientsText] = useState('')
  const [sending, setSending] = useState(null)
  const [toast, setToast] = useState(null)

  function showToast(type, text) { setToast({ type, text }); setTimeout(() => setToast(null), 4500) }

  useEffect(() => { load() }, [])

  async function load() {
    const [s, a] = await Promise.all([supabase.from('report_schedules').select('*').order('created_at'), fetchAllAccounts()])
    setSchedules(s.data || [])
    setAccounts(a)
  }

  function edit(s) {
    setEditing(s ? { ...s } : { ...blank })
    setRecipientsText((s?.recipients || []).join(', '))
  }

  async function save() {
    const recipients = recipientsText.split(/[\s,;]+/).map(r => r.trim()).filter(Boolean)
    const bad = recipients.find(r => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r))
    if (bad) { showToast('error', `"${bad}" isn't an email address`); return }
    if (!editing.name.trim()) { showToast('error', 'Name the report'); return }
    const payload = {
      name: editing.name.trim(), account_ids: editing.account_ids, frequency: editing.frequency,
      send_weekday: Number(editing.send_weekday), recipients, sections: editing.sections, active: editing.active,
    }
    const res = editing.id
      ? await supabase.from('report_schedules').update(payload).eq('id', editing.id)
      : await supabase.from('report_schedules').insert({ ...payload, created_by: profile?.id })
    if (res.error) { showToast('error', res.error.message); return }
    setEditing(null)
    showToast('success', 'Report saved')
    load()
  }

  async function sendNow(s) {
    setSending(s.id)
    const { data, error } = await supabase.functions.invoke('sm-reports', { body: { schedule_id: s.id, send_now: true } })
    setSending(null)
    if (error || !data?.success) { showToast('error', data?.error || 'Could not send the report'); return }
    const result = data.sent?.[s.name]
    showToast(typeof result === 'number' && result > 0 ? 'success' : 'error',
      typeof result === 'number' ? `Sent to ${result} recipient${result === 1 ? '' : 's'}` : `Not sent: ${result}`)
    load()
  }

  async function toggle(s) {
    await supabase.from('report_schedules').update({ active: !s.active }).eq('id', s.id)
    load()
  }

  async function remove(s) {
    if (!window.confirm(`Delete the report "${s.name}"?`)) return
    await supabase.from('report_schedules').delete().eq('id', s.id)
    load()
  }

  const nextSend = s => {
    if (!s.active) return 'Paused'
    const now = DateTime.now()
    if (s.frequency === 'monthly') return `Next: ${now.plus({ months: 1 }).startOf('month').toFormat('d LLL')}, 07:00`
    let d = now.set({ hour: 7, minute: 0 })
    while (d.weekday !== s.send_weekday || d <= now) d = d.plus({ days: 1 }).set({ hour: 7, minute: 0 })
    return `Next: ${d.toFormat('ccc d LLL')}, 07:00`
  }

  return (
    <div className="reports-page">
      <SocialHeader title="Reports" subtitle="Branded performance reports, emailed automatically">
        <button className="btn btn-secondary btn-sm" onClick={() => navigate('/social/analytics')}>PDF from Analytics</button>
        <button className="btn btn-primary btn-sm" onClick={() => edit(null)}>+ New report</button>
      </SocialHeader>

      {schedules.length === 0 ? (
        <div className="section-card"><EmptyState title="No reports yet" action={<button className="btn btn-primary btn-sm" onClick={() => edit(null)}>Create a report</button>}>Set one up and it arrives in your inbox every week or month.</EmptyState></div>
      ) : (
        <div className="rp-list">
          {schedules.map(s => (
            <div key={s.id} className="section-card rp-card">
              <div className="rp-card-main">
                <div className="rp-name">{s.name} {!s.active && <span className="status-badge status-draft">Paused</span>}</div>
                <div className="rp-meta">
                  {s.frequency === 'weekly' ? `Weekly on ${DAYS[s.send_weekday]} · last 7 days` : 'Monthly on the 1st · previous month'}
                  {' · '}{s.recipients?.length ? s.recipients.join(', ') : 'everyone with Reports access'}
                </div>
                <div className="rp-accounts">
                  {(s.account_ids?.length ? accounts.filter(a => s.account_ids.includes(a.id)) : accounts).map(a => <AccountAvatar key={a.id} account={a} size={22} />)}
                  {!s.account_ids?.length && <span className="rp-meta">All accounts</span>}
                </div>
                <div className="rp-meta">{nextSend(s)}{s.last_sent_at ? ` · last sent ${DateTime.fromISO(s.last_sent_at).toRelative()}` : ''}</div>
              </div>
              <div className="rp-actions">
                <button className="btn btn-primary btn-sm" onClick={() => sendNow(s)} disabled={sending === s.id}>{sending === s.id ? 'Sending…' : 'Send now'}</button>
                <button className="btn btn-secondary btn-sm" onClick={() => edit(s)}>Edit</button>
                <button className="btn btn-secondary btn-sm" onClick={() => toggle(s)}>{s.active ? 'Pause' : 'Resume'}</button>
                <button className="btn btn-secondary btn-sm" onClick={() => remove(s)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div className="modal-card modal-card-wide" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">{editing.id ? 'Edit report' : 'New report'}</h3>
            <div className="form-group"><label className="form-label">Name</label><input className="form-input" value={editing.name} onChange={e => setEditing(x => ({ ...x, name: e.target.value }))} placeholder="e.g. Weekly LinkedIn performance" autoFocus /></div>
            <label className="form-label">Accounts (none selected = all)</label>
            <div className="rp-pick">
              {accounts.map(a => {
                const on = editing.account_ids.includes(a.id)
                return (
                  <button key={a.id} className={`sm-chip ${on ? 'active' : ''}`} onClick={() => setEditing(x => ({ ...x, account_ids: on ? x.account_ids.filter(i => i !== a.id) : [...x.account_ids, a.id] }))}>
                    <AccountAvatar account={a} size={20} /><span className="sm-chip-label">{a.account_name}</span>
                  </button>
                )
              })}
            </div>
            <div className="composer-two-col">
              <div className="form-group">
                <label className="form-label">Frequency</label>
                <select className="form-input" value={editing.frequency} onChange={e => setEditing(x => ({ ...x, frequency: e.target.value }))}>
                  <option value="weekly">Weekly (last 7 days)</option>
                  <option value="monthly">Monthly (previous month, on the 1st)</option>
                </select>
              </div>
              {editing.frequency === 'weekly' && (
                <div className="form-group">
                  <label className="form-label">Send on</label>
                  <select className="form-input" value={editing.send_weekday} onChange={e => setEditing(x => ({ ...x, send_weekday: Number(e.target.value) }))}>
                    {DAYS.slice(1).map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="form-group">
              <label className="form-label">Recipients</label>
              <input className="form-input" value={recipientsText} onChange={e => setRecipientsText(e.target.value)} placeholder="Leave empty for everyone with Reports access, or list emails separated by commas" />
            </div>
            <label className="form-label">Include</label>
            {SECTIONS.map(([k, l]) => (
              <label key={k} className="cp-check">
                <input type="checkbox" checked={editing.sections.includes(k)} onChange={() => setEditing(x => ({ ...x, sections: x.sections.includes(k) ? x.sections.filter(s => s !== k) : [...x.sections, k] }))} /> {l}
              </label>
            ))}
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save}>Save</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className={`toast toast-${toast.type}`}>{toast.text}</div>}
    </div>
  )
}
