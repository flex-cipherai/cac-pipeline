import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import { AccountAvatar } from '../../../components/social/SocialUI'

const DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']]
const blank = { name: '', account_ids: [], slots: [{ weekday: 2, time: '10:00' }], avoid_repeat_days: 30, active: true }

// Evergreen autolists (Metricool "Autolists"): a rotation of evergreen posts
// that sm-autolists keeps scheduled into the list's weekly slots, 7 days ahead.
// Items are added from the composer ("Add to autolist").
export default function AutolistsPanel({ accounts, profileId, onClose, onChanged, showToast }) {
  const navigate = useNavigate()
  const [lists, setLists] = useState([])
  const [editing, setEditing] = useState(null) // autolist being edited (draft object)
  const [items, setItems] = useState([])
  const [saving, setSaving] = useState(false)
  const [filling, setFilling] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    const { data } = await supabase.from('autolists').select('*, autolist_items(count)').order('created_at')
    setLists(data || [])
  }

  async function openEditor(list) {
    setEditing(list ? { ...list } : { ...blank, account_ids: accounts.filter(a => a.account_type !== 'member').map(a => a.id).slice(0, 1) })
    if (list) {
      const { data } = await supabase.from('autolist_items').select('id, position, use_count, last_used_at, posts(id, caption, post_type)').eq('autolist_id', list.id).order('position')
      setItems(data || [])
    } else setItems([])
  }

  async function saveList() {
    if (!editing.name.trim()) { showToast('error', 'Name the autolist'); return }
    if (!editing.account_ids.length) { showToast('error', 'Pick at least one account'); return }
    if (!editing.slots.length) { showToast('error', 'Add at least one time slot'); return }
    setSaving(true)
    const payload = {
      name: editing.name.trim(), account_ids: editing.account_ids, slots: editing.slots,
      avoid_repeat_days: Number(editing.avoid_repeat_days) || 0, active: editing.active,
      timezone: accounts.find(a => a.id === editing.account_ids[0])?.timezone || 'Africa/Nairobi',
    }
    const res = editing.id
      ? await supabase.from('autolists').update({ ...payload, filled_until: null }).eq('id', editing.id).select().single()
      : await supabase.from('autolists').insert({ ...payload, created_by: profileId }).select().single()
    setSaving(false)
    if (res.error) { showToast('error', res.error.message); return }
    showToast('success', 'Autolist saved')
    setEditing(null)
    load()
  }

  async function removeItem(item) {
    await supabase.from('autolist_items').delete().eq('id', item.id)
    await supabase.from('posts').delete().eq('id', item.posts.id).eq('is_template', true)
    setItems(prev => prev.filter(i => i.id !== item.id))
  }

  async function moveItem(index, dir) {
    const next = [...items]
    const j = index + dir
    if (j < 0 || j >= next.length) return
    ;[next[index], next[j]] = [next[j], next[index]]
    setItems(next)
    await Promise.all(next.map((it, pos) => supabase.from('autolist_items').update({ position: pos }).eq('id', it.id)))
  }

  async function fillNow(list) {
    setFilling(list.id)
    const { data, error } = await supabase.functions.invoke('sm-autolists', { body: { autolist_id: list.id } })
    setFilling(null)
    if (error || !data?.success) { showToast('error', data?.error || 'Could not fill the autolist'); return }
    const n = data.created?.[list.name] || 0
    showToast('success', n ? `${n} post${n === 1 ? '' : 's'} scheduled from ${list.name}` : 'Nothing to add — the next 7 days are already filled')
    onChanged?.()
  }

  async function toggleActive(list) {
    await supabase.from('autolists').update({ active: !list.active }).eq('id', list.id)
    load()
  }

  async function deleteList(list) {
    if (!window.confirm(`Delete the autolist "${list.name}"? Posts it already scheduled stay on the planner.`)) return
    const { data: its } = await supabase.from('autolist_items').select('post_id').eq('autolist_id', list.id)
    await supabase.from('autolists').delete().eq('id', list.id)
    if (its?.length) await supabase.from('posts').delete().in('id', its.map(i => i.post_id)).eq('is_template', true)
    load()
  }

  const setSlot = (i, patch) => setEditing(e => ({ ...e, slots: e.slots.map((s, idx) => idx === i ? { ...s, ...patch } : s) }))

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="pl-drawer" onClick={e => e.stopPropagation()}>
        <div className="pl-drawer-head">
          <h3 className="modal-title">{editing ? (editing.id ? 'Edit autolist' : 'New autolist') : 'Autolists'}</h3>
          <button className="btn btn-secondary btn-sm" onClick={editing ? () => setEditing(null) : onClose}>{editing ? 'Back' : 'Close'}</button>
        </div>

        {!editing ? (
          <>
            <p className="modal-subtitle">Evergreen content on repeat: the BMS keeps each list's time slots filled a week ahead, rotating through its posts.</p>
            {lists.length === 0 && <p className="form-hint">No autolists yet. Create one, then add posts to it from the composer ("Add to autolist").</p>}
            {lists.map(l => (
              <div key={l.id} className="pl-autolist">
                <div>
                  <div className="pl-autolist-name">{l.name} {!l.active && <span className="status-badge status-draft">Paused</span>}</div>
                  <div className="pl-autolist-meta">
                    {l.autolist_items?.[0]?.count || 0} posts · {l.slots.length} slot{l.slots.length === 1 ? '' : 's'}/week ·{' '}
                    {l.account_ids.map(id => accounts.find(a => a.id === id)?.account_name).filter(Boolean).join(', ') || 'no accounts'}
                  </div>
                </div>
                <div className="pl-autolist-actions">
                  <button className="btn btn-secondary btn-sm" onClick={() => fillNow(l)} disabled={filling === l.id || !l.active}>{filling === l.id ? 'Filling…' : 'Fill now'}</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => toggleActive(l)}>{l.active ? 'Pause' : 'Resume'}</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => openEditor(l)}>Edit</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => deleteList(l)} aria-label="Delete">✕</button>
                </div>
              </div>
            ))}
            <div className="pl-drawer-actions">
              <button className="btn btn-primary btn-sm" onClick={() => openEditor(null)}>+ New autolist</button>
            </div>
          </>
        ) : (
          <>
            <div className="form-group">
              <label className="form-label">Name</label>
              <input className="form-input" value={editing.name} onChange={e => setEditing(x => ({ ...x, name: e.target.value }))} placeholder="e.g. Evergreen tips" autoFocus />
            </div>
            <label className="form-label">Post to</label>
            <div className="pl-account-pick">
              {accounts.map(a => {
                const on = editing.account_ids.includes(a.id)
                return (
                  <button key={a.id} className={`sm-chip ${on ? 'active' : ''}`}
                    onClick={() => setEditing(x => ({ ...x, account_ids: on ? x.account_ids.filter(i => i !== a.id) : [...x.account_ids, a.id] }))}>
                    <AccountAvatar account={a} size={22} /><span className="sm-chip-label">{a.account_name}</span>
                  </button>
                )
              })}
            </div>
            <label className="form-label">Time slots</label>
            {editing.slots.map((s, i) => (
              <div key={i} className="pl-slot-row">
                <select className="form-input" value={s.weekday} onChange={e => setSlot(i, { weekday: Number(e.target.value) })}>
                  {DAYS.map(([d, l]) => <option key={d} value={d}>{l}</option>)}
                </select>
                <input type="time" className="form-input" value={s.time} onChange={e => setSlot(i, { time: e.target.value })} />
                <button className="btn btn-secondary btn-sm" onClick={() => setEditing(x => ({ ...x, slots: x.slots.filter((_, idx) => idx !== i) }))}>✕</button>
              </div>
            ))}
            <button className="btn btn-secondary btn-sm" onClick={() => setEditing(x => ({ ...x, slots: [...x.slots, { weekday: 4, time: '10:00' }] }))}>+ Add slot</button>
            <div className="form-group" style={{ marginTop: 'var(--space-md)' }}>
              <label className="form-label">Don't repeat a post within (days)</label>
              <input type="number" min="0" className="form-input" style={{ maxWidth: 120 }} value={editing.avoid_repeat_days}
                onChange={e => setEditing(x => ({ ...x, avoid_repeat_days: e.target.value }))} />
            </div>

            {editing.id && (
              <>
                <label className="form-label">Posts in rotation ({items.length})</label>
                {items.length === 0 && <p className="form-hint">Add posts from the composer with "Add to autolist".</p>}
                {items.map((it, i) => (
                  <div key={it.id} className="pl-item">
                    <span className="pl-item-pos">{i + 1}</span>
                    <span className="pl-item-caption">{(it.posts?.caption || '(no caption)').slice(0, 90)}</span>
                    <span className="pl-item-meta">used {it.use_count}×</span>
                    <button className="btn btn-secondary btn-sm" onClick={() => moveItem(i, -1)} disabled={i === 0}>↑</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => moveItem(i, 1)} disabled={i === items.length - 1}>↓</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/social/composer/${it.posts.id}`)}>Edit</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => removeItem(it)}>✕</button>
                  </div>
                ))}
              </>
            )}

            <div className="pl-drawer-actions">
              <span style={{ flex: 1 }} />
              <button className="btn btn-primary btn-sm" onClick={saveList} disabled={saving}>{saving ? 'Saving…' : 'Save autolist'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
