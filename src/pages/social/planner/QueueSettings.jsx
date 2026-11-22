import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { fetchBestTimes, topSlots } from '../../../lib/bestTimes'
import { AccountAvatar } from '../../../components/social/SocialUI'

const DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']]

// Posting schedule per account (Metricool "queue"): weekly time slots that
// "Add to queue" fills. Edited as times, each with the days it applies to.
export default function QueueSettings({ accounts, onClose, onSaved, showToast }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id || '')
  const [rows, setRows] = useState([]) // [{ time: '09:00', days: [1,2,3] }]
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const account = accounts.find(a => a.id === accountId)

  useEffect(() => { if (accountId) load(accountId) }, [accountId])

  async function load(id) {
    setLoading(true)
    const { data } = await supabase.from('posting_slots').select('*').eq('account_id', id).eq('active', true).order('slot_time')
    const byTime = new Map()
    for (const s of data || []) {
      const t = String(s.slot_time).slice(0, 5)
      byTime.set(t, [...(byTime.get(t) || []), s.weekday])
    }
    setRows([...byTime.entries()].map(([time, days]) => ({ time, days: days.sort() })))
    setLoading(false)
  }

  async function suggest() {
    const { cells, isDefault } = await fetchBestTimes([account])
    const byTime = new Map()
    for (const s of topSlots(cells, 6)) byTime.set(s.time, [...(byTime.get(s.time) || []), s.weekday])
    setRows([...byTime.entries()].map(([time, days]) => ({ time, days: days.sort() })).sort((a, b) => a.time.localeCompare(b.time)))
    showToast('success', isDefault ? 'Suggested from industry best times — refine once you have results' : 'Suggested from your best-performing times')
  }

  async function save() {
    setSaving(true)
    const slots = rows.flatMap(r => r.time ? r.days.map(d => ({ account_id: accountId, weekday: d, slot_time: r.time, active: true })) : [])
    const { error: delError } = await supabase.from('posting_slots').delete().eq('account_id', accountId)
    const { error } = delError ? { error: delError } : slots.length
      ? await supabase.from('posting_slots').upsert(slots, { onConflict: 'account_id,weekday,slot_time' })
      : { error: null }
    setSaving(false)
    if (error) { showToast('error', error.message || 'Failed to save the schedule'); return }
    showToast('success', `Posting schedule saved for ${account.account_name}`)
    onSaved?.()
  }

  const update = (i, patch) => setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r))
  const toggleDay = (i, d) => update(i, { days: rows[i].days.includes(d) ? rows[i].days.filter(x => x !== d) : [...rows[i].days, d].sort() })

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="pl-drawer" onClick={e => e.stopPropagation()}>
        <div className="pl-drawer-head">
          <h3 className="modal-title">Posting schedule</h3>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
        </div>
        <p className="modal-subtitle">Time slots per account. "Add to queue" in the composer puts a post into the next free slot.</p>

        <div className="pl-account-pick">
          {accounts.map(a => (
            <button key={a.id} className={`sm-chip ${a.id === accountId ? 'active' : ''}`} onClick={() => setAccountId(a.id)}>
              <AccountAvatar account={a} size={22} /><span className="sm-chip-label">{a.account_name}</span>
            </button>
          ))}
        </div>

        {loading ? <div className="skeleton skeleton-card" style={{ height: 160 }} /> : (
          <>
            {rows.length === 0 && <p className="form-hint">No slots yet. Add times, or let the BMS suggest them from your best times.</p>}
            {rows.map((r, i) => (
              <div key={i} className="pl-slot-row">
                <input type="time" className="form-input" value={r.time} onChange={e => update(i, { time: e.target.value })} />
                <div className="pl-days">
                  {DAYS.map(([d, label]) => (
                    <button key={d} className={`pl-day ${r.days.includes(d) ? 'on' : ''}`} onClick={() => toggleDay(i, d)}>{label}</button>
                  ))}
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => setRows(prev => prev.filter((_, idx) => idx !== i))} aria-label="Remove time">✕</button>
              </div>
            ))}
            <div className="pl-drawer-actions">
              <button className="btn btn-secondary btn-sm" onClick={() => setRows(prev => [...prev, { time: '09:00', days: [1, 2, 3, 4, 5] }])}>+ Add time</button>
              <button className="btn btn-secondary btn-sm" onClick={suggest}>Suggest best times</button>
              <span style={{ flex: 1 }} />
              <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save schedule'}</button>
            </div>
            <p className="form-hint">Times are in {account?.timezone || 'Africa/Nairobi'} time.</p>
          </>
        )}
      </div>
    </div>
  )
}
