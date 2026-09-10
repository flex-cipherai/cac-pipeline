import { useState, useEffect, useRef } from 'react'
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

  // Booking configuration
  const [bookingConfig, setBookingConfig] = useState({
    booking_window_days: '14',
    booking_min_notice_hours: '4',
    booking_duration_minutes: '60',
    booking_buffer_minutes: '0',
  })
  const [savingConfig, setSavingConfig] = useState(false)

  // Admin modals
  const [editingUser, setEditingUser] = useState(null)
  const [editRole, setEditRole] = useState('')
  const [showAddUser, setShowAddUser] = useState(false)
  const [newUser, setNewUser] = useState({ name: '', email: '', role: 'sales' })
  const [addingUser, setAddingUser] = useState(false)

  const [toast, setToast] = useState({ show: false, type: '', text: '' })

  // Action menu state
  const [actionMenuId, setActionMenuId] = useState(null)
  const actionMenuRef = useRef(null)

  useEffect(() => {
    fetchData()
  }, [])

  useEffect(() => {
    if (toast.show) {
      const timer = setTimeout(() => setToast({ show: false, type: '', text: '' }), 4000)
      return () => clearTimeout(timer)
    }
  }, [toast.show])

  useEffect(() => {
    function handleClick(e) {
      if (actionMenuRef.current && !actionMenuRef.current.contains(e.target)) {
        setActionMenuId(null)
      }
    }
    if (actionMenuId) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [actionMenuId])

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
      availData.forEach(s => {
        if (!grouped[s.day_of_week]) grouped[s.day_of_week] = []
        if (s.is_available) grouped[s.day_of_week].push(s.time_slot)
      })
      setAvailability(grouped)
    }

    // Fetch booking config from system_settings
    const { data: configData } = await supabase
      .from('system_settings').select('key, value')
      .in('key', ['booking_window_days', 'booking_min_notice_hours', 'booking_duration_minutes', 'booking_buffer_minutes'])
    if (configData) {
      const cfg = { ...bookingConfig }
      configData.forEach(row => { if (row.key && row.value) cfg[row.key] = row.value })
      setBookingConfig(cfg)
    }

    setLoading(false)
  }

  async function saveBookingConfig() {
    setSavingConfig(true)
    try {
      for (const [key, value] of Object.entries(bookingConfig)) {
        await supabase.from('system_settings').upsert({ key, value: String(value) }, { onConflict: 'key' })
      }
      showToast('success', 'Booking settings saved')
    } catch {
      showToast('error', 'Failed to save booking settings')
    } finally {
      setSavingConfig(false)
    }
  }

  function isSlotActive(day, time) {
    return allSlots.some(s => s.day_of_week === day && s.time_slot === time && s.is_available)
  }

  async function toggleSlot(day, time) {
    const existingRow = allSlots.find(s => s.day_of_week === day && s.time_slot === time)
    const active = isSlotActive(day, time)
    if (existingRow) {
      await supabase.from('calendar_availability').update({ is_available: !active }).eq('id', existingRow.id)
      setAllSlots(prev => prev.map(s => s.id === existingRow.id ? { ...s, is_available: !active } : s))
    } else {
      const { data } = await supabase.from('calendar_availability')
        .insert({ day_of_week: day, time_slot: time, is_available: true }).select().single()
      if (data) setAllSlots(prev => [...prev, data])
    }
  }

  // ── User Management (admin only) ──
  const roleLabels = { admin: 'Admin', sales: 'Sales', marketing: 'Marketing' }
  function getUserStatus(user) {
    if (user.is_active === false) return 'deactivated'
    if (!user.last_sign_in_at) return 'pending'
    return 'active'
  }

  function getStatusLabel(status) {
    return { active: 'Active', pending: 'Pending Invite', deactivated: 'Deactivated' }[status]
  }

  function formatLastSignIn(dateStr) {
    if (!dateStr) return 'Never'
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  async function handleAddUser(e) {
    e.preventDefault()
    setAddingUser(true)
    try {
      const { data, error } = await supabase.functions.invoke('manage-users', {
        body: { action: 'create_user', email: newUser.email, name: newUser.name, role: newUser.role },
      })
      if (error) throw new Error('Could not reach the server. Please try again.')
      if (!data?.success) throw new Error(data?.error || 'Failed to create user')

      showToast('success', `Invite sent to ${newUser.email}`)
      setShowAddUser(false)
      setNewUser({ name: '', email: '', role: 'sales' })
      fetchData()
    } catch (err) {
      showToast('error', err.message || 'Failed to add user')
    } finally {
      setAddingUser(false)
    }
  }

  async function handleUpdateRole(userId) {
    try {
      const { data, error } = await supabase.functions.invoke('manage-users', {
        body: { action: 'update_role', user_id: userId, role: editRole },
      })
      if (error) throw new Error('Could not reach the server. Please try again.')
      if (!data?.success) throw new Error(data?.error || 'Failed to update role')
      showToast('success', 'Role updated')
      setEditingUser(null)
      fetchData()
    } catch (err) {
      showToast('error', err.message || 'Failed to update role')
    }
  }

  async function handleToggleActive(user) {
    const newStatus = user.is_active === false ? true : false
    try {
      const { data, error } = await supabase.functions.invoke('manage-users', {
        body: { action: 'toggle_active', user_id: user.id, is_active: newStatus },
      })
      if (error) throw new Error('Could not reach the server. Please try again.')
      if (!data?.success) throw new Error(data?.error || 'Failed to update status')
      showToast('success', newStatus ? 'Account reactivated' : 'Account deactivated')
      setActionMenuId(null)
      fetchData()
    } catch (err) {
      showToast('error', err.message || 'Failed to update account status')
    }
  }

  async function handleResendInvite(user) {
    try {
      const { data, error } = await supabase.functions.invoke('manage-users', {
        body: { action: 'reset_password', email: user.email, redirect_to: `${window.location.origin}/reset-password` },
      })
      if (error) throw new Error('Could not reach the server. Please try again.')
      if (!data?.success) throw new Error(data?.error || 'Failed to send reset email')
      showToast('success', `Password reset sent to ${user.email}`)
      setActionMenuId(null)
    } catch (err) {
      showToast('error', err.message || 'Failed to send reset email')
    }
  }

  if (loading) {
    return (
      <div>
        <div className="page-header"><h1 className="page-title">Settings</h1></div>
        <div className="skeleton skeleton-card" style={{ height: 200 }} />
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
      </div>

      {/* ── User Management (Admin only) ── */}
      {isAdmin && (
        <div className="settings-section">
          <div className="settings-section-header">
            <h2 className="settings-section-title">User Management</h2>
            <button className="btn btn-primary btn-sm" onClick={() => setShowAddUser(true)}>Add User</button>
          </div>

          {/* Desktop table */}
          <div className="settings-card settings-card-overflow">
            <table className="data-table">
              <thead>
                <tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last Sign In</th><th></th></tr>
              </thead>
              <tbody>
                {profiles.map(user => {
                  const status = getUserStatus(user)
                  const isCurrentUser = user.id === currentUser?.id
                  return (
                    <tr key={user.id} className={status === 'deactivated' ? 'row-deactivated' : ''}>
                      <td style={{ fontWeight: 600 }}>{user.name}</td>
                      <td>{user.email}</td>
                      <td>{roleLabels[user.role]}</td>
                      <td><span className={`status-badge status-${status}`}>{getStatusLabel(status)}</span></td>
                      <td className="text-muted">{formatLastSignIn(user.last_sign_in_at)}</td>
                      <td>
                        {!isCurrentUser && (
                          <div className="action-menu-wrap" ref={actionMenuId === user.id ? actionMenuRef : null}>
                            <button className="action-menu-trigger" onClick={() => setActionMenuId(actionMenuId === user.id ? null : user.id)}>
                              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="3" r="1.5" /><circle cx="8" cy="8" r="1.5" /><circle cx="8" cy="13" r="1.5" /></svg>
                            </button>
                            {actionMenuId === user.id && (
                              <div className="action-menu">
                                <button className="action-menu-item" onClick={() => { setEditingUser(user); setEditRole(user.role); setActionMenuId(null) }}>Change Role</button>
                                <button className="action-menu-item" onClick={() => handleResendInvite(user)}>Resend Password Reset</button>
                                {user.is_active === false ? (
                                  <button className="action-menu-item action-reactivate" onClick={() => handleToggleActive(user)}>Reactivate</button>
                                ) : (
                                  <button className="action-menu-item action-danger" onClick={() => handleToggleActive(user)}>Deactivate</button>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="settings-user-mobile-list">
            {profiles.map(user => {
              const status = getUserStatus(user)
              const isCurrentUser = user.id === currentUser?.id
              return (
                <div key={user.id} className="settings-user-card">
                  <div className="settings-user-card-top">
                    <div>
                      <div className="settings-user-card-name">{user.name}</div>
                      <div className="settings-user-card-email">{user.email}</div>
                    </div>
                    {!isCurrentUser && (
                      <div className="action-menu-wrap" ref={actionMenuId === user.id ? actionMenuRef : null}>
                        <button className="action-menu-trigger" onClick={() => setActionMenuId(actionMenuId === user.id ? null : user.id)}>
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="3" r="1.5" /><circle cx="8" cy="8" r="1.5" /><circle cx="8" cy="13" r="1.5" /></svg>
                        </button>
                        {actionMenuId === user.id && (
                          <div className="action-menu">
                            <button className="action-menu-item" onClick={() => { setEditingUser(user); setEditRole(user.role); setActionMenuId(null) }}>Change Role</button>
                            <button className="action-menu-item" onClick={() => handleResendInvite(user)}>Resend Password Reset</button>
                            {user.is_active === false ? (
                              <button className="action-menu-item action-reactivate" onClick={() => handleToggleActive(user)}>Reactivate</button>
                            ) : (
                              <button className="action-menu-item action-danger" onClick={() => handleToggleActive(user)}>Deactivate</button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="settings-user-card-meta">
                    <span className="settings-user-card-meta-item">{roleLabels[user.role]}</span>
                    <span className={`status-badge status-${status}`}>{getStatusLabel(status)}</span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Add User Modal */}
          {showAddUser && (
            <div className="modal-overlay" onClick={() => setShowAddUser(false)}>
              <div className="modal-card" onClick={e => e.stopPropagation()}>
                <h3 className="modal-title">Add New User</h3>
                <p className="modal-subtitle">They'll receive an email to set their password.</p>
                <form onSubmit={handleAddUser}>
                  <div className="form-group">
                    <label className="form-label">Full Name</label>
                    <input className="form-input" required value={newUser.name} onChange={e => setNewUser({ ...newUser, name: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Email</label>
                    <input className="form-input" type="email" required value={newUser.email} onChange={e => setNewUser({ ...newUser, email: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Role</label>
                    <select className="form-input" value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value })}>
                      <option value="sales">Sales Manager</option>
                      <option value="marketing">Marketing Manager</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <div className="modal-actions">
                    <button type="button" className="btn btn-secondary" onClick={() => setShowAddUser(false)}>Cancel</button>
                    <button type="submit" className="btn btn-primary" disabled={addingUser}>{addingUser ? 'Sending...' : 'Send Invite'}</button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Edit Role Modal */}
          {editingUser && (
            <div className="modal-overlay" onClick={() => setEditingUser(null)}>
              <div className="modal-card" onClick={e => e.stopPropagation()}>
                <h3 className="modal-title">Change Role</h3>
                <p className="modal-subtitle">Update {editingUser.name}'s access level.</p>
                <div className="form-group">
                  <label className="form-label">Role</label>
                  <select className="form-input" value={editRole} onChange={e => setEditRole(e.target.value)}>
                    <option value="admin">Admin</option>
                    <option value="sales">Sales Manager</option>
                    <option value="marketing">Marketing Manager</option>
                  </select>
                </div>
                <div className="modal-actions">
                  <button className="btn btn-secondary" onClick={() => setEditingUser(null)}>Cancel</button>
                  <button className="btn btn-primary" onClick={() => handleUpdateRole(editingUser.id)}>Save</button>
                </div>
              </div>
            </div>
          )}
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

      {/* ── Booking Configuration ── */}
      <div className="settings-section">
        <div className="settings-section-header">
          <h2 className="settings-section-title">Booking Configuration</h2>
        </div>
        <div className="section-card" style={{ padding: 'var(--space-lg)' }}>
          <div className="booking-config-grid">
            <div className="form-group">
              <label className="form-label">Meeting duration</label>
              <select className="form-input" value={bookingConfig.booking_duration_minutes} onChange={e => setBookingConfig({ ...bookingConfig, booking_duration_minutes: e.target.value })}>
                <option value="30">30 minutes</option>
                <option value="45">45 minutes</option>
                <option value="60">60 minutes</option>
                <option value="90">90 minutes</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Booking window</label>
              <select className="form-input" value={bookingConfig.booking_window_days} onChange={e => setBookingConfig({ ...bookingConfig, booking_window_days: e.target.value })}>
                <option value="7">7 days ahead</option>
                <option value="14">14 days ahead</option>
                <option value="21">21 days ahead</option>
                <option value="30">30 days ahead</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Minimum notice</label>
              <select className="form-input" value={bookingConfig.booking_min_notice_hours} onChange={e => setBookingConfig({ ...bookingConfig, booking_min_notice_hours: e.target.value })}>
                <option value="2">2 hours</option>
                <option value="4">4 hours</option>
                <option value="8">8 hours</option>
                <option value="24">24 hours (1 day)</option>
                <option value="48">48 hours (2 days)</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Buffer between calls</label>
              <select className="form-input" value={bookingConfig.booking_buffer_minutes} onChange={e => setBookingConfig({ ...bookingConfig, booking_buffer_minutes: e.target.value })}>
                <option value="0">No buffer</option>
                <option value="15">15 minutes</option>
                <option value="30">30 minutes</option>
                <option value="60">60 minutes</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-md)' }}>
            <button className="btn btn-primary btn-sm" onClick={saveBookingConfig} disabled={savingConfig}>
              {savingConfig ? 'Saving...' : 'Save Configuration'}
            </button>
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

      {/* Toast */}
      {toast.show && (
        <div className={`toast toast-${toast.type}`}>
          {toast.type === 'success' ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 8.5l3 3 5-6" /></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="8" cy="8" r="6" /><path d="M8 5v3.5M8 10.5v.5" /></svg>
          )}
          {toast.text}
        </div>
      )}
    </div>
  )
}
