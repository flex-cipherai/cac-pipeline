import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { SettingsHeading } from './SettingsLayout'
import useToast from './useToast'

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
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

const MoreIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="3" r="1.5" /><circle cx="8" cy="8" r="1.5" /><circle cx="8" cy="13" r="1.5" /></svg>
)

export default function UsersSettings() {
  const { profile: currentUser } = useAuth()
  const { showToast, toast } = useToast()

  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [actionMenuId, setActionMenuId] = useState(null)

  const [showAddUser, setShowAddUser] = useState(false)
  const [newUser, setNewUser] = useState({ name: '', email: '', role: 'sales' })
  const [addingUser, setAddingUser] = useState(false)

  const [editingUser, setEditingUser] = useState(null)
  const [editRole, setEditRole] = useState('')

  const [deletingUser, setDeletingUser] = useState(null)
  const [deletingUserBusy, setDeletingUserBusy] = useState(false)

  useEffect(() => { fetchData() }, [])

  useEffect(() => {
    function handleClick(e) {
      if (!e.target.closest('.action-menu-wrap')) setActionMenuId(null)
    }
    if (actionMenuId) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [actionMenuId])

  async function fetchData() {
    const { data } = await supabase.from('profiles').select('*').order('created_at')
    if (data) setProfiles(data)
    setLoading(false)
  }

  // Every user action goes through the manage-users Edge Function (admin only, service role).
  async function callManageUsers(body, fallbackError) {
    const { data, error } = await supabase.functions.invoke('manage-users', { body })
    if (error) throw new Error('Could not reach the server. Please try again.')
    if (!data?.success) throw new Error(data?.error || fallbackError)
  }

  async function handleAddUser(e) {
    e.preventDefault()
    setAddingUser(true)
    try {
      await callManageUsers(
        { action: 'create_user', email: newUser.email, name: newUser.name, role: newUser.role, redirect_origin: window.location.origin },
        'Failed to create user',
      )
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
      await callManageUsers({ action: 'update_role', user_id: userId, role: editRole }, 'Failed to update role')
      showToast('success', 'Role updated')
      setEditingUser(null)
      fetchData()
    } catch (err) {
      showToast('error', err.message || 'Failed to update role')
    }
  }

  async function handleToggleActive(user) {
    const newStatus = user.is_active === false
    try {
      await callManageUsers({ action: 'toggle_active', user_id: user.id, is_active: newStatus }, 'Failed to update status')
      showToast('success', newStatus ? 'Account reactivated' : 'Account deactivated')
      setActionMenuId(null)
      fetchData()
    } catch (err) {
      showToast('error', err.message || 'Failed to update account status')
    }
  }

  async function handleResendInvite(user) {
    try {
      await callManageUsers(
        { action: 'reset_password', email: user.email, redirect_to: `${window.location.origin}/reset-password` },
        'Failed to send reset email',
      )
      showToast('success', `Password reset sent to ${user.email}`)
      setActionMenuId(null)
    } catch (err) {
      showToast('error', err.message || 'Failed to send reset email')
    }
  }

  async function handleDeleteUser() {
    if (!deletingUser) return
    setDeletingUserBusy(true)
    try {
      await callManageUsers({ action: 'delete_user', user_id: deletingUser.id }, 'Failed to delete user')
      showToast('success', `${deletingUser.name} was deleted`)
      setDeletingUser(null)
      fetchData()
    } catch (err) {
      showToast('error', err.message || 'Failed to delete user')
    } finally {
      setDeletingUserBusy(false)
    }
  }

  function renderActionMenu(user) {
    return (
      <div className="action-menu-wrap">
        <button className="action-menu-trigger" onClick={() => setActionMenuId(actionMenuId === user.id ? null : user.id)} aria-label={`Actions for ${user.name}`}>
          {MoreIcon}
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
            <button className="action-menu-item action-danger" onClick={() => { setDeletingUser(user); setActionMenuId(null) }}>Delete Account</button>
          </div>
        )}
      </div>
    )
  }

  if (loading) {
    return (
      <div>
        <SettingsHeading title="Users" />
        <div className="skeleton skeleton-card" style={{ height: 200 }} />
      </div>
    )
  }

  return (
    <div>
      <SettingsHeading
        title="Users"
        hint="Who can sign in, and which role they have. What each role can open is set under Permissions."
        actions={<button className="btn btn-primary btn-sm" onClick={() => setShowAddUser(true)}>Add User</button>}
      />

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
                  <td>{!isCurrentUser && renderActionMenu(user)}</td>
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
                {!isCurrentUser && renderActionMenu(user)}
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

      {deletingUser && (
        <div className="modal-overlay" onClick={() => !deletingUserBusy && setDeletingUser(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Delete Account</h3>
            <p className="modal-subtitle">
              Permanently delete <strong>{deletingUser.name}</strong>'s account ({deletingUser.email})? They will lose access immediately.
              This cannot be undone — deactivate instead if you might need to restore access later. Their past notes and stage history stay on the leads, just without attribution.
            </p>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setDeletingUser(null)} disabled={deletingUserBusy}>Cancel</button>
              <button className="btn btn-danger" onClick={handleDeleteUser} disabled={deletingUserBusy}>
                {deletingUserBusy ? 'Deleting...' : 'Delete Account'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast}
    </div>
  )
}
