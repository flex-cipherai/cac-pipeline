import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { DAYS_OF_WEEK, CLASSIFICATION_THRESHOLDS, HARD_DISQUALIFIERS } from '../lib/scoring'
import './Settings.css'

export default function Settings() {
  const [profiles, setProfiles] = useState([])
  const [availability, setAvailability] = useState({})
  const [loading, setLoading] = useState(true)

  // Edit user modal state
  const [editingUser, setEditingUser] = useState(null)
  const [editRole, setEditRole] = useState('')

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    // Fetch profiles
    const { data: profileData } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at')

    if (profileData) setProfiles(profileData)

    // Fetch availability
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

  // Role display names
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
        <h2 className="settings-section-title">User Management</h2>
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
              <button className="btn btn-secondary" onClick={() => setEditingUser(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleUpdateRole}>
                Save
              </button>
            </div>
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
