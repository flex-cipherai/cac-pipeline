import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { DAYS_OF_WEEK, CLASSIFICATION_THRESHOLDS, HARD_DISQUALIFIERS } from '../lib/scoring'
import './Settings.css'

export default function Settings() {
  const { profile: currentUser } = useAuth()
  const [profiles, setProfiles] = useState([])
  const [availability, setAvailability] = useState({})
  const [loading, setLoading] = useState(true)

  // Modals
  const [editingUser, setEditingUser] = useState(null)
  const [editRole, setEditRole] = useState('')
  const [showAddUser, setShowAddUser] = useState(false)
  const [newUser, setNewUser] = useState({ name: '', email: '', role: 'sales' })
  const [addingUser, setAddingUser] = useState(false)

  // Feedback
  const [toast, setToast] = useState({ show: false, type: '', text: '' })

  useEffect(() => {
    fetchData()
  }, [])

  // Auto-hide toast
  useEffect(() => {
    if (toast.show) {
      const timer = setTimeout(() => setToast({ show: false, type: '', text: '' }), 4000)
      return () => clearTimeout(timer)
    }
  }, [toast.show])

  function showToast(type, text) {
    setToast({ show: true, type, text })
  }

  async function fetchData() {
    const { data: profileData } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at')

    if (profileData) setProfiles(profileData)

    const { data: availData } = await supabase
      .from('calendar_availability')
      .select('*')
      .eq('is_available', true)
      .order('day_of_week')
      .order('time_slot')

    if (availData) {
      const grouped = {}
      availData.forEach(slot => {
        if (!grouped[slot.day_of_week]) grouped[slot.day_of_week] = []
        grouped[slot.day_of_week].push(slot.time_slot)
      })
      setAvailability(grouped)
    }

    setLoading(false)
  }

  const roleLabels = {
    admin: 'Admin',
    sales: 'Sales',
    marketing: 'Marketing',
  }

  // User status
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

  // Format last sign-in
  function formatLastSignIn(dateStr) {
    if (!dateStr) return '—'
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now - date
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  }

  // Actions
  async function handleUpdateRole() {
    if (!editingUser || !editRole) return

    await supabase
      .from('profiles')
      .update({ role: editRole })
      .eq('id', editingUser.id)

    setProfiles(prev =>
      prev.map(p => p.id === editingUser.id ? { ...p, role: editRole } : p)
    )
    setEditingUser(null)
    showToast('success', `Role updated to ${roleLabels[editRole]} for ${editingUser.name}.`)
  }

  async function handleToggleActive(user) {
    const newStatus = !user.is_active
    const action = newStatus ? 'reactivated' : 'deactivated'

    await supabase
      .from('profiles')
      .update({ is_active: newStatus })
      .eq('id', user.id)

    setProfiles(prev =>
      prev.map(p => p.id === user.id ? { ...p, is_active: newStatus } : p)
    )
    showToast('success', `${user.name} has been ${action}.`)
  }

  async function handleResendResetEmail(user) {
    try {
      const tempClient = createClient(
        import.meta.env.VITE_SUPABASE_URL,
        import.meta.env.VITE_SUPABASE_ANON_KEY
      )
      const { error } = await tempClient.auth.resetPasswordForEmail(user.email, {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      if (error) throw error
      showToast('success', `Password reset email sent to ${user.email}.`)
    } catch (err) {
      showToast('error', 'Could not send reset email. Try again.')
    }
  }

  async function handleAddUser(e) {
    e.preventDefault()
    if (!newUser.name.trim() || !newUser.email.trim()) return

    setAddingUser(true)

    try {
      const tempClient = createClient(
        import.meta.env.VITE_SUPABASE_URL,
        import.meta.env.VITE_SUPABASE_ANON_KEY
      )

      const tempPassword = crypto.randomUUID().slice(0, 16) + 'A1!'

      const { error: signUpError } = await tempClient.auth.signUp({
        email: newUser.email,
        password: tempPassword,
        options: {
          data: {
            name: newUser.name,
            role: newUser.role,
          },
        },
      })

      if (signUpError) throw signUpError

      // Send password reset so user can set their own password
      await tempClient.auth.resetPasswordForEmail(newUser.email, {
        redirectTo: `${window.location.origin}/reset-password`,
      })

      // Refresh profiles
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at')

      if (profileData) setProfiles(profileData)

      setShowAddUser(false)
      setNewUser({ name: '', email: '', role: 'sales' })
      showToast('success', `Account created for ${newUser.name}. A password reset link has been sent to ${newUser.email}.`)
    } catch (err) {
      let msg = 'Could not create account. '
      if (err.message?.includes('already registered')) {
        msg += 'This email is already registered.'
      } else {
        msg += err.message || 'Please try again.'
      }
      showToast('error', msg)
    } finally {
      setAddingUser(false)
    }
  }

  // Action menu
  const [openMenu, setOpenMenu] = useState(null)

  function toggleMenu(userId) {
    setOpenMenu(openMenu === userId ? null : userId)
  }

  // Close menu on click outside
  useEffect(() => {
    if (openMenu) {
      const handler = () => setOpenMenu(null)
      document.addEventListener('click', handler)
      return () => document.removeEventListener('click', handler)
    }
  }, [openMenu])

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Admin Settings</h1>
        </div>
        <div className="skeleton skeleton-card" style={{ height: 200, marginBottom: 'var(--space-xl)' }} />
        <div className="skeleton skeleton-card" style={{ height: 160 }} />
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Admin Settings</h1>
      </div>

      {/* Toast notification */}
      {toast.show && (
        <div className={`toast toast-${toast.type}`} role="status">
          {toast.type === 'success' && (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="8" cy="8" r="6.5" />
              <path d="M5.5 8.5l2 2 3.5-4" />
            </svg>
          )}
          {toast.type === 'error' && (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="8" cy="8" r="6.5" />
              <line x1="8" y1="5" x2="8" y2="8.5" />
              <circle cx="8" cy="11" r="0.5" fill="currentColor" />
            </svg>
          )}
          <span>{toast.text}</span>
        </div>
      )}

      {/* User Management */}
      <div className="settings-section">
        <div className="settings-section-header">
          <h2 className="settings-section-title">User Management</h2>
          <button className="btn btn-primary btn-sm" onClick={() => setShowAddUser(true)}>
            + Add User
          </button>
        </div>
        <div className="settings-card">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last Sign In</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {profiles.map(p => {
                const status = getUserStatus(p)
                const isSelf = p.id === currentUser?.id
                return (
                  <tr key={p.id} className={status === 'deactivated' ? 'row-deactivated' : ''}>
                    <td className="leads-name">{p.name}</td>
                    <td>{p.email}</td>
                    <td>{roleLabels[p.role] || p.role}</td>
                    <td>{getStatusBadge(status)}</td>
                    <td className="text-muted">{formatLastSignIn(p.last_sign_in_at)}</td>
                    <td>
                      <div className="action-menu-wrap">
                        <button
                          className="action-menu-trigger"
                          onClick={e => { e.stopPropagation(); toggleMenu(p.id) }}
                          aria-label={`Actions for ${p.name}`}
                        >
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <circle cx="8" cy="3" r="1.5" />
                            <circle cx="8" cy="8" r="1.5" />
                            <circle cx="8" cy="13" r="1.5" />
                          </svg>
                        </button>
                        {openMenu === p.id && (
                          <div className="action-menu" onClick={e => e.stopPropagation()}>
                            <button
                              className="action-menu-item"
                              onClick={() => { setEditingUser(p); setEditRole(p.role); setOpenMenu(null) }}
                            >
                              Edit Role
                            </button>
                            <button
                              className="action-menu-item"
                              onClick={() => { handleResendResetEmail(p); setOpenMenu(null) }}
                            >
                              Resend Reset Email
                            </button>
                            {!isSelf && (
                              <button
                                className={`action-menu-item ${status === 'deactivated' ? 'action-reactivate' : 'action-danger'}`}
                                onClick={() => { handleToggleActive(p); setOpenMenu(null) }}
                              >
                                {status === 'deactivated' ? 'Reactivate' : 'Deactivate'}
                              </button>
                            )}
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
            const status = getUserStatus(p)
            const isSelf = p.id === currentUser?.id
            return (
              <div key={p.id} className={`settings-user-card ${status === 'deactivated' ? 'row-deactivated' : ''}`}>
                <div className="settings-user-card-top">
                  <div>
                    <div className="settings-user-card-name">{p.name}</div>
                    <div className="settings-user-card-email">{p.email}</div>
                  </div>
                  <div className="action-menu-wrap">
                    <button
                      className="action-menu-trigger"
                      onClick={e => { e.stopPropagation(); toggleMenu(p.id) }}
                      aria-label={`Actions for ${p.name}`}
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <circle cx="8" cy="3" r="1.5" />
                        <circle cx="8" cy="8" r="1.5" />
                        <circle cx="8" cy="13" r="1.5" />
                      </svg>
                    </button>
                    {openMenu === p.id && (
                      <div className="action-menu" onClick={e => e.stopPropagation()}>
                        <button className="action-menu-item" onClick={() => { setEditingUser(p); setEditRole(p.role); setOpenMenu(null) }}>Edit Role</button>
                        <button className="action-menu-item" onClick={() => { handleResendResetEmail(p); setOpenMenu(null) }}>Resend Reset Email</button>
                        {!isSelf && (
                          <button className={`action-menu-item ${status === 'deactivated' ? 'action-reactivate' : 'action-danger'}`} onClick={() => { handleToggleActive(p); setOpenMenu(null) }}>
                            {status === 'deactivated' ? 'Reactivate' : 'Deactivate'}
                          </button>
                        )}
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

      {/* Edit Role Modal */}
      {editingUser && (
        <div className="modal-overlay" onClick={() => setEditingUser(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Edit Role — {editingUser.name}</h3>
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
            <p className="modal-subtitle">
              The user will receive a password reset email to set their own password.
            </p>

            <form onSubmit={handleAddUser}>
              <div className="form-group">
                <label className="form-label" htmlFor="new-name">Full Name</label>
                <input
                  id="new-name"
                  type="text"
                  className="form-input"
                  placeholder="e.g. Diana Wanjiku"
                  value={newUser.name}
                  onChange={e => setNewUser({ ...newUser, name: e.target.value })}
                  required
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="new-email">Email</label>
                <input
                  id="new-email"
                  type="email"
                  className="form-input"
                  placeholder="e.g. diana@cipherai.co.ke"
                  value={newUser.email}
                  onChange={e => setNewUser({ ...newUser, email: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="new-role">Role</label>
                <select
                  id="new-role"
                  className="form-input"
                  value={newUser.role}
                  onChange={e => setNewUser({ ...newUser, role: e.target.value })}
                >
                  <option value="sales">Sales Manager</option>
                  <option value="marketing">Marketing Manager</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddUser(false)}>Cancel</button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={addingUser || !newUser.name.trim() || !newUser.email.trim()}
                >
                  {addingUser ? 'Creating...' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Calendar Availability */}
      <div className="settings-section">
        <h2 className="settings-section-title">Calendar Availability</h2>
        <div className="settings-card">
          <div className="settings-calendar">
            {DAYS_OF_WEEK.map(day => {
              const slots = availability[day.value] || []
              return (
                <div key={day.value} className="settings-cal-day">
                  <div className="settings-cal-day-label">{day.label}</div>
                  <div className="settings-cal-slots">
                    {slots.length > 0 ? slots.map(time => (
                      <div key={time} className="settings-cal-slot">{time}</div>
                    )) : (
                      <div className="settings-cal-slot empty">No slots</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Scoring Configuration */}
      <div className="settings-section">
        <h2 className="settings-section-title">Scoring Configuration</h2>
        <div className="settings-scoring-cards">
          <div className="settings-score-card hot">
            <div className="settings-score-label">Hot</div>
            <div className="settings-score-range">{CLASSIFICATION_THRESHOLDS.hot.min} – {CLASSIFICATION_THRESHOLDS.hot.max}</div>
          </div>
          <div className="settings-score-card warm">
            <div className="settings-score-label">Warm</div>
            <div className="settings-score-range">{CLASSIFICATION_THRESHOLDS.warm.min} – {CLASSIFICATION_THRESHOLDS.warm.max}</div>
          </div>
          <div className="settings-score-card cold">
            <div className="settings-score-label">Cold</div>
            <div className="settings-score-range">{CLASSIFICATION_THRESHOLDS.cold.min} – {CLASSIFICATION_THRESHOLDS.cold.max}</div>
          </div>
        </div>

        <div className="settings-card" style={{ marginTop: 'var(--space-md)' }}>
          <h3 className="settings-disq-title">Hard Disqualifiers</h3>
          {HARD_DISQUALIFIERS.map((d, i) => (
            <p key={i} className="settings-disq-item">• {d.question}: {d.response}</p>
          ))}
        </div>
      </div>
    </div>
  )
}
