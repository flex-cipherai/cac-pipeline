import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { DAYS_OF_WEEK, CLASSIFICATION_THRESHOLDS, HARD_DISQUALIFIERS } from '../lib/scoring'
import './Settings.css'

export default function Settings() {
  const [profiles, setProfiles] = useState([])
  const [availability, setAvailability] = useState({})
  const [loading, setLoading] = useState(true)

  // Edit user modal
  const [editingUser, setEditingUser] = useState(null)
  const [editRole, setEditRole] = useState('')

  // Add user modal
  const [showAddUser, setShowAddUser] = useState(false)
  const [newUser, setNewUser] = useState({ name: '', email: '', role: 'sales' })
  const [addingUser, setAddingUser] = useState(false)
  const [addUserMessage, setAddUserMessage] = useState({ type: '', text: '' })

  useEffect(() => {
    fetchData()
  }, [])

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

  // Handle role update
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
    setEditRole('')
  }

  // Handle add user
  async function handleAddUser(e) {
    e.preventDefault()
    if (!newUser.name.trim() || !newUser.email.trim()) return

    setAddingUser(true)
    setAddUserMessage({ type: '', text: '' })

    try {
      // Create a separate Supabase client so the admin's session is not affected
      const tempClient = createClient(
        import.meta.env.VITE_SUPABASE_URL,
        import.meta.env.VITE_SUPABASE_ANON_KEY
      )

      // Generate a random temporary password
      const tempPassword = crypto.randomUUID().slice(0, 16) + 'A1!'

      // Sign up the new user
      const { data: signUpData, error: signUpError } = await tempClient.auth.signUp({
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

      // Send a password reset email so the user can set their own password
      const { error: resetError } = await tempClient.auth.resetPasswordForEmail(
        newUser.email,
        { redirectTo: `${window.location.origin}/reset-password` }
      )

      if (resetError) {
        console.warn('Reset email failed:', resetError)
      }

      // Refresh the profiles list
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at')

      if (profileData) setProfiles(profileData)

      setAddUserMessage({
        type: 'success',
        text: `Account created for ${newUser.name}. A password reset link has been sent to ${newUser.email}.`,
      })
      setNewUser({ name: '', email: '', role: 'sales' })

      // Auto-close after a moment
      setTimeout(() => {
        setShowAddUser(false)
        setAddUserMessage({ type: '', text: '' })
      }, 4000)
    } catch (err) {
      console.error('Add user error:', err)
      let msg = 'Could not create account. '
      if (err.message?.includes('already registered')) {
        msg += 'This email is already registered.'
      } else {
        msg += err.message || 'Please try again.'
      }
      setAddUserMessage({ type: 'error', text: msg })
    } finally {
      setAddingUser(false)
    }
  }

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Admin Settings</h1>
        </div>
        <p style={{ color: 'var(--text-secondary)' }}>Loading...</p>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Admin Settings</h1>
      </div>

      {/* User Management */}
      <div className="settings-section">
        <div className="settings-section-header">
          <h2 className="settings-section-title">User Management</h2>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              setShowAddUser(true)
              setAddUserMessage({ type: '', text: '' })
            }}
          >
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
                <th></th>
              </tr>
            </thead>
            <tbody>
              {profiles.map(p => (
                <tr key={p.id}>
                  <td className="leads-name">{p.name}</td>
                  <td>{p.email}</td>
                  <td>{roleLabels[p.role] || p.role}</td>
                  <td>
                    <button
                      className="settings-edit-btn"
                      onClick={() => {
                        setEditingUser(p)
                        setEditRole(p.role)
                      }}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Role Modal */}
      {editingUser && (
        <div className="modal-overlay" onClick={() => setEditingUser(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Edit Role — {editingUser.name}</h3>
            <div className="form-group">
              <label className="form-label">Role</label>
              <select
                className="form-input"
                value={editRole}
                onChange={e => setEditRole(e.target.value)}
              >
                <option value="admin">Admin</option>
                <option value="sales">Sales</option>
                <option value="marketing">Marketing</option>
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

              {addUserMessage.text && (
                <div className={`settings-message ${addUserMessage.type}`} role="alert">
                  {addUserMessage.text}
                </div>
              )}

              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddUser(false)}>
                  Cancel
                </button>
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
            <div className="settings-score-range">
              {CLASSIFICATION_THRESHOLDS.hot.min} – {CLASSIFICATION_THRESHOLDS.hot.max}
            </div>
          </div>
          <div className="settings-score-card warm">
            <div className="settings-score-label">Warm</div>
            <div className="settings-score-range">
              {CLASSIFICATION_THRESHOLDS.warm.min} – {CLASSIFICATION_THRESHOLDS.warm.max}
            </div>
          </div>
          <div className="settings-score-card cold">
            <div className="settings-score-label">Cold</div>
            <div className="settings-score-range">
              {CLASSIFICATION_THRESHOLDS.cold.min} – {CLASSIFICATION_THRESHOLDS.cold.max}
            </div>
          </div>
        </div>

        <div className="settings-card" style={{ marginTop: 'var(--space-md)' }}>
          <h3 className="settings-disq-title">Hard Disqualifiers</h3>
          {HARD_DISQUALIFIERS.map((d, i) => (
            <p key={i} className="settings-disq-item">
              • {d.question}: {d.response}
            </p>
          ))}
        </div>
      </div>
    </div>
  )
}
