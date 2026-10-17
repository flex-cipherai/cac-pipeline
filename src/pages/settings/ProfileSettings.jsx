import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { COMMON_TIMEZONES, detectTimezone, formatOffsetLabel } from '../../lib/timezone'
import { SettingsHeading } from './SettingsLayout'
import useToast from './useToast'

export default function ProfileSettings() {
  const { profile: currentUser, refreshProfile } = useAuth()
  const { showToast, toast } = useToast()

  const [myName, setMyName] = useState(currentUser?.name || '')
  const [myPhone, setMyPhone] = useState(currentUser?.phone || '')
  const [myJobTitle, setMyJobTitle] = useState(currentUser?.job_title || '')
  const [myTimezone, setMyTimezone] = useState(currentUser?.timezone || detectTimezone())
  const [savingProfile, setSavingProfile] = useState(false)

  const [showPasswordForm, setShowPasswordForm] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)

  async function saveMyProfile() {
    setSavingProfile(true)
    try {
      const updates = { name: myName.trim(), phone: myPhone.trim(), job_title: myJobTitle.trim(), timezone: myTimezone }
      const { error } = await supabase.from('profiles').update(updates).eq('id', currentUser.id)
      if (error) throw error
      await refreshProfile()
      showToast('success', 'Profile updated')
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

  return (
    <div>
      <SettingsHeading title="My profile" hint="How you appear to the team, and the timezone your call times are shown in." />

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

      {toast}
    </div>
  )
}
