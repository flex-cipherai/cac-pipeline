import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { DAYS_OF_WEEK, CLASSIFICATION_THRESHOLDS, HARD_DISQUALIFIERS } from '../lib/scoring'
import './Settings.css'

const ALL_TIME_SLOTS = [
  '08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00'
]

export default function Settings() {
  const { profile: currentUser } = useAuth()
  const isAdmin = currentUser?.role === 'admin'

  const [profiles, setProfiles] = useState([])
  const [availability, setAvailability] = useState({})
  const [allSlots, setAllSlots] = useState([])
  const [loading, setLoading] = useState(true)

  // Admin modals
  const [editingUser, setEditingUser] = useState(null)
  const [editRole, setEditRole] = useState('')
  const [showAddUser, setShowAddUser] = useState(false)
  const [newUser, setNewUser] = useState({ name: '', email: '', role: 'sales' })
  const [addingUser, setAddingUser] = useState(false)

  // Per-user Google Calendar
  const [gcalStatus, setGcalStatus] = useState({ connected: false, email: null })
  const [gcalLoading, setGcalLoading] = useState(false)

  const [toast, setToast] = useState({ show: false, type: '', text: '' })

  useEffect(() => {
    fetchData()
    handleGCalCallback()
  }, [])

  // Re-check Google Calendar status whenever currentUser becomes available
  useEffect(() => {
    if (currentUser?.id) {
      checkGoogleCalendar()
    }
  }, [currentUser?.id])

  useEffect(() => {
    if (toast.show) {
      const timer = setTimeout(() => setToast({ show: false, type: '', text: '' }), 4000)
      return () => clearTimeout(timer)
    }
  }, [toast.show])

  function showToast(type, text) { setToast({ show: true, type, text }) }

  async function fetchData() {
    if (isAdmin) {
      const { data: profileData } = await supabase.from('profiles').select('*').order('created_at')
      if (profileData) setProfiles(profileData)
    }

    const { data: availData } = await supabase
      .from('calendar_availability').select('*').order('day_of_week').order('time_slot')

    if (availData) {
      setAllSlots(availData)
      const grouped = {}
      availData.filter(s => s.is_available).forEach(slot => {
        if (!grouped[slot.day_of_week]) grouped[slot.day_of_week] = []
        grouped[slot.day_of_week].push(slot.time_slot)
      })
      setAvailability(grouped)
    }
    setLoading(false)
  }

  // ── Calendar ──
  function isSlotActive(day, time) { return (availability[day] || []).includes(time) }

  async function toggleSlot(day, time) {
    const active = isSlotActive(day, time)
    const existingRow = allSlots.find(s => s.day_of_week === day && s.time_slot === time)

    setAvailability(prev => {
      const daySlots = prev[day] || []
      return active
        ? { ...prev, [day]: daySlots.filter(t => t !== time) }
        : { ...prev, [day]: [...daySlots, time].sort() }
    })

    if (existingRow) {
      await supabase.from('calendar_availability').update({ is_available: !active }).eq('id', existingRow.id)
      setAllSlots(prev => prev.map(s => s.id === existingRow.id ? { ...s, is_available: !active } : s))
    } else {
      const { data } = await supabase.from('calendar_availability')
        .insert({ day_of_week: day, time_slot: time, is_available: true }).select().single()
      if (data) setAllSlots(prev => [...prev, data])
    }
  }

  // ── Per-User Google Calendar ──

  async function checkGoogleCalendar() {
    if (!currentUser?.id) return
    try {
      const { data, error } = await supabase.functions.invoke('google-calendar', {
        body: { action: 'status', user_id: currentUser.id },
      })
      if (!error && data?.connected) {
        setGcalStatus({ connected: true, email: data.email })
      } else {
        setGcalStatus({ connected: false, email: null })
      }
    } catch {
      setGcalStatus({ connected: false, email: null })
    }
  }

  async function connectGoogleCalendar() {
    setGcalLoading(true)
    try {
      const { data, error } = await supabase.functions.invoke('google-calendar', {
        body: { action: 'get-auth-url', user_id: currentUser.id },
      })
      if (error) throw error
      // Store user_id in sessionStorage so callback knows which user
      sessionStorage.setItem('gcal_connecting_user', currentUser.id)
      if (data?.url) window.location.href = data.url
    } catch {
      showToast('error', 'Could not start Google Calendar connection. Ensure the Edge Function is deployed.')
      setGcalLoading(false)
    }
  }

  async function disconnectGoogleCalendar() {
    try {
      const { error } = await supabase.functions.invoke('google-calendar', {
        body: { action: 'disconnect', user_id: currentUser.id },
      })
      if (error) throw error
      setGcalStatus({ connected: false, email: null })
      showToast('success', 'Google Calendar disconnected.')
    } catch {
      showToast('error', 'Could not disconnect. Try again.')
    }
  }

  async function handleGCalCallback() {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    if (!code) return

    // Google returns user_id in the state param (set during auth URL generation)
    const stateUserId = params.get('state')
    window.history.replaceState({}, '', window.location.pathname)

    const userId = stateUserId || sessionStorage.getItem('gcal_connecting_user') || currentUser?.id
    sessionStorage.removeItem('gcal_connecting_user')

    setGcalLoading(true)
    try {
      const { data, error } = await supabase.functions.invoke('google-calendar', {
        body: { action: 'exchange-code', code, user_id: userId },
      })
      if (error) throw error
      if (data?.success) {
        setGcalStatus({ connected: true, email: data.email })
        showToast('success', `Google Calendar connected as ${data.email}`)
      }
    } catch {
      showToast('error', 'Failed to connect Google Calendar. Try again.')
    } finally {
      setGcalLoading(false)
    }
  }

  // ── User Management (admin only) ──
  const roleLabels = { admin: 'Admin', sales: 'Sales', marketing: 'Marketing' }
  function getUserStatus(user) {
    if (user.is_active === false) return 'deactivated'
    if (!user.last_sign_in_at) return 'pending'
    return 'active'
  }
  function getStatusBadge(status) {
    const config = {
      active: { label: 'Active', className: 'status-active' },
      pending: { label: 'Pending Invite', className: 'status-pending' },
      deactivated: { label: 'Deactivated', className: 'status-deactivated' },
    }
    const c = config[status] || config.active
    return <span className={`status-badge ${c.className}`}>{c.label}</span>
  }
  function formatLastSignIn(dateStr) {
    if (!dateStr) return '—'
    const d = new Date(dateStr), now = new Date(), ms = now - d
    const mins = Math.floor(ms / 60000), hrs = Math.floor(ms / 3600000), days = Math.floor(ms / 86400000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins}m ago`
    if (hrs < 24) return `${hrs}h ago`
    if (days < 7) return `${days}d ago`
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  }
  async function handleUpdateRole() {
    if (!editingUser || !editRole) return
    await supabase.from('profiles').update({ role: editRole }).eq('id', editingUser.id)
    setProfiles(prev => prev.map(p => p.id === editingUser.id ? { ...p, role: editRole } : p))
    setEditingUser(null)
    showToast('success', `Role updated to ${roleLabels[editRole]} for ${editingUser.name}.`)
  }
  async function handleToggleActive(user) {
    const ns = !user.is_active
    await supabase.from('profiles').update({ is_active: ns }).eq('id', user.id)
    setProfiles(prev => prev.map(p => p.id === user.id ? { ...p, is_active: ns } : p))
    showToast('success', `${user.name} has been ${ns ? 'reactivated' : 'deactivated'}.`)
  }
  async function handleResendResetEmail(user) {
    try {
      const tc = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)
      const { error } = await tc.auth.resetPasswordForEmail(user.email, { redirectTo: `${window.location.origin}/reset-password` })
      if (error) throw error
      showToast('success', `Password reset email sent to ${user.email}.`)
    } catch { showToast('error', 'Could not send reset email. Try again.') }
  }
  async function handleAddUser(e) {
    e.preventDefault()
    if (!newUser.name.trim() || !newUser.email.trim()) return
    setAddingUser(true)
    try {
      const tc = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)
      const pw = crypto.randomUUID().slice(0, 16) + 'A1!'
      const { error } = await tc.auth.signUp({ email: newUser.email, password: pw, options: { data: { name: newUser.name, role: newUser.role } } })
      if (error) throw error
      await tc.auth.resetPasswordForEmail(newUser.email, { redirectTo: `${window.location.origin}/reset-password` })
      const { data } = await supabase.from('profiles').select('*').order('created_at')
      if (data) setProfiles(data)
      setShowAddUser(false)
      setNewUser({ name: '', email: '', role: 'sales' })
      showToast('success', `Account created for ${newUser.name}. Password reset link sent to ${newUser.email}.`)
    } catch (err) {
      showToast('error', err.message?.includes('already registered') ? 'This email is already registered.' : (err.message || 'Could not create account.'))
    } finally { setAddingUser(false) }
  }

  const [openMenu, setOpenMenu] = useState(null)
  function toggleMenu(id) { setOpenMenu(openMenu === id ? null : id) }
  useEffect(() => {
    if (openMenu) { const h = () => setOpenMenu(null); document.addEventListener('click', h); return () => document.removeEventListener('click', h) }
  }, [openMenu])

  const pageTitle = isAdmin ? 'Admin Settings' : 'Settings'

  if (loading) {
    return (
      <div>
        <div className="page-header"><h1 className="page-title">{pageTitle}</h1></div>
        <div className="skeleton skeleton-card" style={{ height: 200, marginBottom: 'var(--space-xl)' }} />
        <div className="skeleton skeleton-card" style={{ height: 160 }} />
      </div>
    )
  }

  return (
    <div>
      <div className="page-header"><h1 className="page-title">{pageTitle}</h1></div>

      {toast.show && (
        <div className={`toast toast-${toast.type}`} role="status">
          {toast.type === 'success' && <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="8" cy="8" r="6.5" /><path d="M5.5 8.5l2 2 3.5-4" /></svg>}
          {toast.type === 'error' && <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6.5" /><line x1="8" y1="5" x2="8" y2="8.5" /><circle cx="8" cy="11" r="0.5" fill="currentColor" /></svg>}
          <span>{toast.text}</span>
        </div>
      )}

      {/* ── User Management (Admin only) ── */}
      {isAdmin && (
        <div className="settings-section">
          <div className="settings-section-header">
            <h2 className="settings-section-title">User Management</h2>
            <button className="btn btn-primary btn-sm" onClick={() => setShowAddUser(true)}>+ Add User</button>
          </div>
          <div className="settings-card settings-card-overflow">
            <table className="data-table">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last Sign In</th><th></th></tr></thead>
              <tbody>
                {profiles.map(p => {
                  const status = getUserStatus(p); const isSelf = p.id === currentUser?.id
                  return (
                    <tr key={p.id} className={status === 'deactivated' ? 'row-deactivated' : ''}>
                      <td className="leads-name">{p.name}</td><td>{p.email}</td><td>{roleLabels[p.role] || p.role}</td>
                      <td>{getStatusBadge(status)}</td><td className="text-muted">{formatLastSignIn(p.last_sign_in_at)}</td>
                      <td>
                        <div className="action-menu-wrap">
                          <button className="action-menu-trigger" onClick={e => { e.stopPropagation(); toggleMenu(p.id) }}>
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="3" r="1.5" /><circle cx="8" cy="8" r="1.5" /><circle cx="8" cy="13" r="1.5" /></svg>
                          </button>
                          {openMenu === p.id && (
                            <div className="action-menu" onClick={e => e.stopPropagation()}>
                              <button className="action-menu-item" onClick={() => { setEditingUser(p); setEditRole(p.role); setOpenMenu(null) }}>Edit Role</button>
                              <button className="action-menu-item" onClick={() => { handleResendResetEmail(p); setOpenMenu(null) }}>Resend Reset Email</button>
                              {!isSelf && <button className={`action-menu-item ${status === 'deactivated' ? 'action-reactivate' : 'action-danger'}`} onClick={() => { handleToggleActive(p); setOpenMenu(null) }}>{status === 'deactivated' ? 'Reactivate' : 'Deactivate'}</button>}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {/* Mobile user cards */}
          <div className="settings-user-mobile-list">
            {profiles.map(p => {
              const status = getUserStatus(p); const isSelf = p.id === currentUser?.id
              return (
                <div key={p.id} className={`settings-user-card ${status === 'deactivated' ? 'row-deactivated' : ''}`}>
                  <div className="settings-user-card-top">
                    <div><div className="settings-user-card-name">{p.name}</div><div className="settings-user-card-email">{p.email}</div></div>
                    <div className="action-menu-wrap">
                      <button className="action-menu-trigger" onClick={e => { e.stopPropagation(); toggleMenu(p.id) }}>
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="3" r="1.5" /><circle cx="8" cy="8" r="1.5" /><circle cx="8" cy="13" r="1.5" /></svg>
                      </button>
                      {openMenu === p.id && (
                        <div className="action-menu" onClick={e => e.stopPropagation()}>
                          <button className="action-menu-item" onClick={() => { setEditingUser(p); setEditRole(p.role); setOpenMenu(null) }}>Edit Role</button>
                          <button className="action-menu-item" onClick={() => { handleResendResetEmail(p); setOpenMenu(null) }}>Resend Reset Email</button>
                          {!isSelf && <button className={`action-menu-item ${status === 'deactivated' ? 'action-reactivate' : 'action-danger'}`} onClick={() => { handleToggleActive(p); setOpenMenu(null) }}>{status === 'deactivated' ? 'Reactivate' : 'Deactivate'}</button>}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="settings-user-card-meta">
                    <span className="settings-user-card-meta-item">{roleLabels[p.role] || p.role}</span>
                    {getStatusBadge(status)}
                    <span className="settings-user-card-meta-item">{formatLastSignIn(p.last_sign_in_at)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Edit Role Modal */}
      {editingUser && (
        <div className="modal-overlay" onClick={() => setEditingUser(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Edit Role — {editingUser.name}</h3>
            <div className="form-group"><label className="form-label">Role</label>
              <select className="form-input" value={editRole} onChange={e => setEditRole(e.target.value)}>
                <option value="admin">Admin</option><option value="sales">Sales Manager</option><option value="marketing">Marketing Manager</option>
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setEditingUser(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleUpdateRole}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Add User Modal */}
      {showAddUser && (
        <div className="modal-overlay" onClick={() => setShowAddUser(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Add New User</h3>
            <p className="modal-subtitle">The user will receive a password reset email to set their own password.</p>
            <form onSubmit={handleAddUser}>
              <div className="form-group"><label className="form-label" htmlFor="nn">Full Name</label><input id="nn" type="text" className="form-input" placeholder="e.g. Diana Wanjiku" value={newUser.name} onChange={e => setNewUser({ ...newUser, name: e.target.value })} required autoFocus /></div>
              <div className="form-group"><label className="form-label" htmlFor="ne">Email</label><input id="ne" type="email" className="form-input" placeholder="e.g. diana@cipherai.co.ke" value={newUser.email} onChange={e => setNewUser({ ...newUser, email: e.target.value })} required /></div>
              <div className="form-group"><label className="form-label" htmlFor="nr">Role</label>
                <select id="nr" className="form-input" value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value })}>
                  <option value="sales">Sales Manager</option><option value="marketing">Marketing Manager</option><option value="admin">Admin</option>
                </select>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddUser(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={addingUser || !newUser.name.trim() || !newUser.email.trim()}>{addingUser ? 'Creating...' : 'Create Account'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Calendar Availability (both roles) ── */}
      <div className="settings-section">
        <div className="settings-section-header">
          <h2 className="settings-section-title">Calendar Availability</h2>
          <p className="settings-section-hint">Click a time slot to toggle it on or off</p>
        </div>
        <div className="section-card">
          <div className="settings-calendar-grid">
            {DAYS_OF_WEEK.map(day => (
              <div key={day.value} className="settings-cal-column">
                <div className="settings-cal-day-header">{day.label}</div>
                <div className="settings-cal-slots">
                  {ALL_TIME_SLOTS.map(time => (
                    <button key={time} className={`settings-cal-toggle ${isSlotActive(day.value, time) ? 'active' : ''}`} onClick={() => toggleSlot(day.value, time)} title={isSlotActive(day.value, time) ? `Remove ${time}` : `Add ${time}`}>
                      {time}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Google Calendar Sync (per user) ── */}
      <div className="settings-section">
        <h2 className="settings-section-title">Google Calendar Sync</h2>
        <div className="section-card">
          <div className="settings-gcal">
            <div className="settings-gcal-info">
              <div className="settings-gcal-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" /><path d="M3 9h18" stroke="currentColor" strokeWidth="1.5" /><path d="M8 2v4M16 2v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><rect x="7" y="12" width="4" height="3" rx="0.5" fill="currentColor" opacity="0.3" /><rect x="13" y="12" width="4" height="3" rx="0.5" fill="currentColor" opacity="0.3" /></svg>
              </div>
              <div>
                {gcalStatus.connected ? (
                  <><div className="settings-gcal-status connected">Connected</div><div className="settings-gcal-email">{gcalStatus.email}</div><p className="settings-gcal-desc">Discovery calls will be automatically added to your Google Calendar.</p></>
                ) : (
                  <><div className="settings-gcal-status">Not connected</div><p className="settings-gcal-desc">Connect your Google Calendar so discovery calls are automatically created as calendar events.</p></>
                )}
              </div>
            </div>
            <div className="settings-gcal-action">
              {gcalStatus.connected
                ? <button className="btn btn-secondary btn-sm" onClick={disconnectGoogleCalendar}>Disconnect</button>
                : <button className="btn btn-primary btn-sm" onClick={connectGoogleCalendar} disabled={gcalLoading}>{gcalLoading ? 'Connecting...' : 'Connect Calendar'}</button>
              }
            </div>
          </div>
        </div>
      </div>

      {/* ── Scoring (Admin only) ── */}
      {isAdmin && (
        <div className="settings-section">
          <h2 className="settings-section-title">Scoring Configuration</h2>
          <div className="settings-scoring-cards">
            <div className="settings-score-card hot"><div className="settings-score-label">Hot</div><div className="settings-score-range">{CLASSIFICATION_THRESHOLDS.hot.min} – {CLASSIFICATION_THRESHOLDS.hot.max}</div></div>
            <div className="settings-score-card warm"><div className="settings-score-label">Warm</div><div className="settings-score-range">{CLASSIFICATION_THRESHOLDS.warm.min} – {CLASSIFICATION_THRESHOLDS.warm.max}</div></div>
            <div className="settings-score-card cold"><div className="settings-score-label">Cold</div><div className="settings-score-range">{CLASSIFICATION_THRESHOLDS.cold.min} – {CLASSIFICATION_THRESHOLDS.cold.max}</div></div>
          </div>
          <div className="settings-card" style={{ marginTop: 'var(--space-md)', padding: 'var(--space-lg)' }}>
            <h3 className="settings-disq-title" style={{ padding: 0 }}>Hard Disqualifiers</h3>
            {HARD_DISQUALIFIERS.map((d, i) => <p key={i} className="settings-disq-item" style={{ paddingLeft: 0 }}>• {d.question}: {d.response}</p>)}
          </div>
        </div>
      )}
    </div>
  )
}
