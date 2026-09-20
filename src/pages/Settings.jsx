import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { DAYS_OF_WEEK, CLASSIFICATION_THRESHOLDS, HARD_DISQUALIFIERS } from '../lib/scoring'
import { COMMON_TIMEZONES, detectTimezone, formatOffsetLabel } from '../lib/timezone'
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
    reminder_hours_before_call: '24',
    team_timezone: 'Africa/Nairobi',
  })
  const [savingConfig, setSavingConfig] = useState(false)

  // My Profile editing
  const [myName, setMyName] = useState('')
  const [myPhone, setMyPhone] = useState('')
  const [myJobTitle, setMyJobTitle] = useState('')
  const [myTimezone, setMyTimezone] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPasswordForm, setShowPasswordForm] = useState(false)

  // Social Media Management — Connected Accounts & Content Defaults (admin only)
  const [connectedAccount, setConnectedAccount] = useState(null)
  const [accountNameDraft, setAccountNameDraft] = useState('')
  const [savingAccount, setSavingAccount] = useState(false)
  const [hashtagSets, setHashtagSets] = useState([])
  const [newHashtagSetName, setNewHashtagSetName] = useState('')
  const [newHashtagSetTags, setNewHashtagSetTags] = useState('')
  const [contentDefaults, setContentDefaults] = useState({
    sm_approval_workflow_enabled: 'false',
    sm_default_utm_source: 'linkedin',
    sm_default_utm_medium: 'social',
    sm_signature_link: '',
    app_base_url: '',
  })
  const [savingDefaults, setSavingDefaults] = useState(false)

  // Admin modals
  const [editingUser, setEditingUser] = useState(null)
  const [editRole, setEditRole] = useState('')
  const [showAddUser, setShowAddUser] = useState(false)
  const [newUser, setNewUser] = useState({ name: '', email: '', role: 'sales' })
  const [addingUser, setAddingUser] = useState(false)
  const [deletingUser, setDeletingUser] = useState(null)
  const [deletingUserBusy, setDeletingUserBusy] = useState(false)

  const [toast, setToast] = useState({ show: false, type: '', text: '' })

  // Action menu state
  const [actionMenuId, setActionMenuId] = useState(null)

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
      if (!e.target.closest('.action-menu-wrap')) {
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

      const { data: accountData } = await supabase.from('connected_accounts').select('*').eq('platform', 'linkedin').maybeSingle()
      if (accountData) { setConnectedAccount(accountData); setAccountNameDraft(accountData.account_name) }

      const { data: hashtagData } = await supabase.from('hashtag_sets').select('*').order('name')
      if (hashtagData) setHashtagSets(hashtagData)

      const { data: defaultsData } = await supabase
        .from('system_settings').select('key, value')
        .in('key', ['sm_approval_workflow_enabled', 'sm_default_utm_source', 'sm_default_utm_medium', 'sm_signature_link', 'app_base_url'])
      if (defaultsData) {
        const cfg = { ...contentDefaults }
        defaultsData.forEach(row => { if (row.key && row.value !== null) cfg[row.key] = row.value })
        setContentDefaults(cfg)
      }
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
      .in('key', ['booking_window_days', 'booking_min_notice_hours', 'booking_duration_minutes', 'booking_buffer_minutes', 'reminder_hours_before_call', 'team_timezone'])
    if (configData) {
      const cfg = { ...bookingConfig }
      configData.forEach(row => { if (row.key && row.value) cfg[row.key] = row.value })
      setBookingConfig(cfg)
    }

    // Init profile fields
    if (currentUser) {
      setMyName(currentUser.name || '')
      setMyPhone(currentUser.phone || '')
      setMyJobTitle(currentUser.job_title || '')
      setMyTimezone(currentUser.timezone || detectTimezone())
    }

    setLoading(false)
  }

  async function saveMyProfile() {
    setSavingProfile(true)
    try {
      const updates = { name: myName.trim(), phone: myPhone.trim(), job_title: myJobTitle.trim(), timezone: myTimezone }
      const { error } = await supabase.from('profiles').update(updates).eq('id', currentUser.id)
      if (error) throw error
      showToast('success', 'Profile updated')
      // Refresh the auth context profile
      window.location.reload()
    } catch (err) {
      showToast('error', err.message || 'Failed to update profile')
    } finally {
      setSavingProfile(false)
    }
  }

  async function handleChangePassword(e) {
    e.preventDefault()
    if (newPassword.length < 8) {
      showToast('error', 'Password must be at least 8 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      showToast('error', 'Passwords do not match')
      return
    }
    setChangingPassword(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error
      showToast('success', 'Password updated successfully')
      setNewPassword('')
      setConfirmPassword('')
      setShowPasswordForm(false)
    } catch (err) {
      showToast('error', err.message || 'Failed to update password')
    } finally {
      setChangingPassword(false)
    }
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

  // ── Connected Accounts ──
  async function saveAccountName() {
    if (!connectedAccount || !accountNameDraft.trim()) return
    setSavingAccount(true)
    const { error } = await supabase.from('connected_accounts').update({ account_name: accountNameDraft.trim() }).eq('id', connectedAccount.id)
    setSavingAccount(false)
    if (error) { showToast('error', 'Failed to update account'); return }
    setConnectedAccount(prev => ({ ...prev, account_name: accountNameDraft.trim() }))
    showToast('success', 'Account updated')
  }

  async function toggleAccountStatus() {
    if (!connectedAccount) return
    const newStatus = connectedAccount.status === 'active' ? 'disconnected' : 'active'
    const { error } = await supabase.from('connected_accounts').update({ status: newStatus }).eq('id', connectedAccount.id)
    if (error) { showToast('error', 'Failed to update status'); return }
    setConnectedAccount(prev => ({ ...prev, status: newStatus }))
    showToast('success', newStatus === 'active' ? 'Account reactivated' : 'Account disconnected')
  }

  // ── Content Defaults ──
  async function saveContentDefaults() {
    setSavingDefaults(true)
    try {
      for (const [key, value] of Object.entries(contentDefaults)) {
        await supabase.from('system_settings').upsert({ key, value: String(value) }, { onConflict: 'key' })
      }
      showToast('success', 'Content defaults saved')
    } catch {
      showToast('error', 'Failed to save content defaults')
    } finally {
      setSavingDefaults(false)
    }
  }

  async function addHashtagSet() {
    if (!newHashtagSetName.trim()) return
    const hashtags = newHashtagSetTags.split(/[\s,]+/).map(h => h.replace(/^#/, '').trim()).filter(Boolean)
    const { data, error } = await supabase.from('hashtag_sets').insert({ name: newHashtagSetName.trim(), hashtags }).select().single()
    if (error) { showToast('error', 'Failed to add hashtag set'); return }
    setHashtagSets(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
    setNewHashtagSetName('')
    setNewHashtagSetTags('')
  }

  async function deleteHashtagSet(id) {
    await supabase.from('hashtag_sets').delete().eq('id', id)
    setHashtagSets(prev => prev.filter(h => h.id !== id))
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
        body: { action: 'create_user', email: newUser.email, name: newUser.name, role: newUser.role, redirect_origin: window.location.origin },
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

  async function handleDeleteUser() {
    if (!deletingUser) return
    setDeletingUserBusy(true)
    try {
      const { data, error } = await supabase.functions.invoke('manage-users', {
        body: { action: 'delete_user', user_id: deletingUser.id },
      })
      if (error) throw new Error('Could not reach the server. Please try again.')
      if (!data?.success) throw new Error(data?.error || 'Failed to delete user')
      showToast('success', `${deletingUser.name} was deleted`)
      setDeletingUser(null)
      fetchData()
    } catch (err) {
      showToast('error', err.message || 'Failed to delete user')
    } finally {
      setDeletingUserBusy(false)
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

      {/* ── My Profile (all roles) ── */}
      <div className="settings-section">
        <div className="settings-section-header">
          <h2 className="settings-section-title">My Profile</h2>
        </div>
        <div className="section-card" style={{ padding: 'var(--space-lg)' }}>
          <div className="profile-edit-grid">
            <div className="form-group">
              <label className="form-label">Full Name</label>
              <input className="form-input" value={myName} onChange={e => setMyName(e.target.value)} placeholder="Your full name" />
            </div>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input className="form-input" value={currentUser?.email || ''} disabled style={{ opacity: 0.6 }} />
              <span className="form-hint">Email cannot be changed. Contact an admin if needed.</span>
            </div>
            <div className="form-group">
              <label className="form-label">Job Title</label>
              <input className="form-input" value={myJobTitle} onChange={e => setMyJobTitle(e.target.value)} placeholder="e.g. Sales Manager" />
            </div>
            <div className="form-group">
              <label className="form-label">Phone Number</label>
              <input className="form-input" value={myPhone} onChange={e => setMyPhone(e.target.value)} placeholder="+254 700 000 000" />
            </div>
            <div className="form-group">
              <label className="form-label">My Timezone</label>
              <select className="form-input" value={myTimezone} onChange={e => setMyTimezone(e.target.value)}>
                {!COMMON_TIMEZONES.includes(myTimezone) && myTimezone && (
                  <option value={myTimezone}>{formatOffsetLabel(myTimezone)}</option>
                )}
                {COMMON_TIMEZONES.map(tz => (
                  <option key={tz} value={tz}>{formatOffsetLabel(tz)}</option>
                ))}
              </select>
              <span className="form-hint">Scheduled call times shown to you across the app and in team emails use this timezone.</span>
            </div>
          </div>
          <div className="profile-actions-row">
            <button className="btn btn-primary btn-sm" onClick={saveMyProfile} disabled={savingProfile}>
              {savingProfile ? 'Saving...' : 'Save Profile'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowPasswordForm(!showPasswordForm)}>
              {showPasswordForm ? 'Cancel' : 'Change Password'}
            </button>
          </div>

          {showPasswordForm && (
            <form onSubmit={handleChangePassword} className="password-change-form">
              <div className="profile-edit-grid">
                <div className="form-group">
                  <label className="form-label">New Password</label>
                  <input className="form-input" type="password" required minLength={8} value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Min 8 characters" />
                </div>
                <div className="form-group">
                  <label className="form-label">Confirm Password</label>
                  <input className="form-input" type="password" required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Re-enter password" />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-sm)' }}>
                <button type="submit" className="btn btn-primary btn-sm" disabled={changingPassword}>
                  {changingPassword ? 'Updating...' : 'Update Password'}
                </button>
              </div>
            </form>
          )}
        </div>
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
                          <div className="action-menu-wrap">
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
                                <button className="action-menu-item action-danger" onClick={() => { setDeletingUser(user); setActionMenuId(null) }}>Delete Account</button>
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
                      <div className="action-menu-wrap">
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
                            <button className="action-menu-item action-danger" onClick={() => { setDeletingUser(user); setActionMenuId(null) }}>Delete Account</button>
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
            <div className="form-group">
              <label className="form-label">Reminder timing</label>
              <select className="form-input" value={bookingConfig.reminder_hours_before_call} onChange={e => setBookingConfig({ ...bookingConfig, reminder_hours_before_call: e.target.value })}>
                <option value="1">1 hour before</option>
                <option value="2">2 hours before</option>
                <option value="4">4 hours before</option>
                <option value="24">24 hours before</option>
                <option value="48">48 hours before</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Team timezone</label>
              <select className="form-input" value={bookingConfig.team_timezone} onChange={e => setBookingConfig({ ...bookingConfig, team_timezone: e.target.value })}>
                {!COMMON_TIMEZONES.includes(bookingConfig.team_timezone) && bookingConfig.team_timezone && (
                  <option value={bookingConfig.team_timezone}>{formatOffsetLabel(bookingConfig.team_timezone)}</option>
                )}
                {COMMON_TIMEZONES.map(tz => (
                  <option key={tz} value={tz}>{formatOffsetLabel(tz)}</option>
                ))}
              </select>
              <span className="form-hint">The timezone Calendar Availability slots above are defined in.</span>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-md)' }}>
            <button className="btn btn-primary btn-sm" onClick={saveBookingConfig} disabled={savingConfig}>
              {savingConfig ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Connected Accounts (Admin only) ── */}
      {isAdmin && (
        <div className="settings-section">
          <div className="settings-section-header">
            <h2 className="settings-section-title">Connected Accounts</h2>
          </div>
          <div className="section-card" style={{ padding: 'var(--space-lg)' }}>
            {connectedAccount ? (
              <>
                <div className="sm-account-row">
                  <div>
                    <div className="sm-account-platform">LinkedIn Company Page</div>
                    <span className={`status-badge status-${connectedAccount.status === 'active' ? 'posted' : 'draft'}`}>{connectedAccount.status === 'active' ? 'Active' : 'Disconnected'}</span>
                    <span className="status-badge" style={{ marginLeft: 6, color: 'var(--text-secondary)', background: 'var(--bg-gray)' }}>
                      {connectedAccount.mode === 'automated' ? 'Automated Mode' : 'Assisted Mode'}
                    </span>
                  </div>
                  <button className="btn btn-secondary btn-sm" onClick={toggleAccountStatus}>
                    {connectedAccount.status === 'active' ? 'Disconnect' : 'Reconnect'}
                  </button>
                </div>
                <div className="profile-edit-grid" style={{ marginTop: 'var(--space-md)' }}>
                  <div className="form-group">
                    <label className="form-label">Account Name</label>
                    <input className="form-input" value={accountNameDraft} onChange={e => setAccountNameDraft(e.target.value)} />
                  </div>
                </div>
                <p className="form-hint">
                  Assisted Mode is used until LinkedIn's Marketing Developer Platform access is approved — publishing and
                  analytics stay manual until then. This switches automatically once API access is granted; there's nothing to toggle here.
                </p>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-sm)' }}>
                  <button className="btn btn-primary btn-sm" onClick={saveAccountName} disabled={savingAccount}>{savingAccount ? 'Saving...' : 'Save'}</button>
                </div>
              </>
            ) : (
              <p className="form-hint">No LinkedIn account connected yet.</p>
            )}
          </div>
        </div>
      )}

      {/* ── Content Defaults (Admin only) ── */}
      {isAdmin && (
        <div className="settings-section">
          <div className="settings-section-header">
            <h2 className="settings-section-title">Content Defaults</h2>
          </div>
          <div className="section-card" style={{ padding: 'var(--space-lg)' }}>
            <label className="checkbox-label" style={{ marginBottom: 'var(--space-md)' }}>
              <input
                type="checkbox"
                checked={contentDefaults.sm_approval_workflow_enabled === 'true'}
                onChange={e => setContentDefaults(prev => ({ ...prev, sm_approval_workflow_enabled: e.target.checked ? 'true' : 'false' }))}
              />
              Require Admin approval before posts can be scheduled
            </label>

            <div className="profile-edit-grid">
              <div className="form-group">
                <label className="form-label">Default UTM Source</label>
                <input className="form-input" value={contentDefaults.sm_default_utm_source} onChange={e => setContentDefaults(prev => ({ ...prev, sm_default_utm_source: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Default UTM Medium</label>
                <input className="form-input" value={contentDefaults.sm_default_utm_medium} onChange={e => setContentDefaults(prev => ({ ...prev, sm_default_utm_medium: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Signature Link</label>
                <input className="form-input" value={contentDefaults.sm_signature_link} onChange={e => setContentDefaults(prev => ({ ...prev, sm_signature_link: e.target.value }))} placeholder="https://sdfmgroup.com" />
              </div>
              <div className="form-group">
                <label className="form-label">App URL (for links in emails)</label>
                <input className="form-input" value={contentDefaults.app_base_url} onChange={e => setContentDefaults(prev => ({ ...prev, app_base_url: e.target.value }))} placeholder="https://your-site.netlify.app" />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--space-lg)' }}>
              <button className="btn btn-primary btn-sm" onClick={saveContentDefaults} disabled={savingDefaults}>{savingDefaults ? 'Saving...' : 'Save Defaults'}</button>
            </div>

            <h3 className="settings-disq-title" style={{ padding: 0, marginBottom: 'var(--space-sm)' }}>Hashtag Sets</h3>
            {hashtagSets.length > 0 && (
              <div className="sm-hashtag-list">
                {hashtagSets.map(set => (
                  <div key={set.id} className="sm-hashtag-row">
                    <div>
                      <strong>{set.name}</strong>
                      <span className="form-hint" style={{ marginLeft: 8 }}>{set.hashtags.map(h => `#${h}`).join(' ')}</span>
                    </div>
                    <button className="action-menu-item action-danger" style={{ width: 'auto', padding: '4px 8px' }} onClick={() => deleteHashtagSet(set.id)}>Remove</button>
                  </div>
                ))}
              </div>
            )}
            <div className="profile-edit-grid" style={{ marginTop: 'var(--space-sm)' }}>
              <div className="form-group">
                <label className="form-label">New Set Name</label>
                <input className="form-input" value={newHashtagSetName} onChange={e => setNewHashtagSetName(e.target.value)} placeholder="e.g. Case Studies" />
              </div>
              <div className="form-group">
                <label className="form-label">Hashtags</label>
                <input className="form-input" value={newHashtagSetTags} onChange={e => setNewHashtagSetTags(e.target.value)} placeholder="#AI #KenyaBusiness" />
              </div>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={addHashtagSet}>Add Hashtag Set</button>
          </div>
        </div>
      )}

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
