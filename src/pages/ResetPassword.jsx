import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'
import './Login.css'

export default function ResetPassword() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const navigate = useNavigate()

  const passwordValid = password.length >= 6
  const confirmValid = confirm === password && confirm.length > 0

  async function handleReset(e) {
    e.preventDefault()
    if (!passwordValid || !confirmValid) return
    setError('')
    setLoading(true)

    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      setSuccess(true)
      setTimeout(() => navigate('/login'), 3000)
    } catch (err) {
      setError('Could not update password. The link may have expired — request a new one.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-brand">
        <div className="login-brand-content">
          <div className="login-brand-logo">
            <img src="/sdfm-logo.png" alt="SDFM Group Limited" className="login-brand-logo-img" />
          </div>
          <h2 className="login-brand-name">Sales Management Pipeline</h2>
          <p className="login-brand-tagline">Transforming Kenyan Businesses</p>
        </div>
      </div>

      <div className="login-form-panel">
        <div className="login-form-container">
          {success ? (
            <div className="login-sent">
              <div className="login-sent-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--sdfm-red)" strokeWidth="2">
                  <path d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h1 className="login-title">Password updated</h1>
              <p className="login-subtitle">
                Your password has been changed. Redirecting you to sign in...
              </p>
            </div>
          ) : (
            <>
              <h1 className="login-title">Set a new password</h1>
              <p className="login-subtitle">Choose a strong password for your account.</p>

              <form onSubmit={handleReset} className="login-form" noValidate>
                <div className="form-group">
                  <label className="form-label" htmlFor="new-password">New password</label>
                  <div className="login-password-wrap">
                    <input
                      id="new-password"
                      type={showPassword ? 'text' : 'password'}
                      className="form-input"
                      placeholder="At least 6 characters"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      autoComplete="new-password"
                      required
                    />
                    <button
                      type="button"
                      className="login-password-toggle"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? (
                        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M2.5 2.5l13 13" />
                          <path d="M7.3 7.3a2.4 2.4 0 0 0 3.4 3.4" />
                          <path d="M4.2 5.2C2.8 6.4 1.8 8 1.5 9c.7 2.2 3.5 5.5 7.5 5.5.9 0 1.8-.2 2.5-.5" />
                          <path d="M14 12.8c1.3-1.2 2.2-2.7 2.5-3.8-.7-2.2-3.5-5.5-7.5-5.5-.5 0-1 .05-1.5.15" />
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M1.5 9c.7-2.2 3.5-5.5 7.5-5.5S15.8 6.8 16.5 9c-.7 2.2-3.5 5.5-7.5 5.5S2.2 11.2 1.5 9z" />
                          <circle cx="9" cy="9" r="2.5" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="confirm-password">Confirm password</label>
                  <input
                    id="confirm-password"
                    type={showPassword ? 'text' : 'password'}
                    className={`form-input ${confirm && !confirmValid ? 'form-input-error' : ''}`}
                    placeholder="Re-enter your password"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    autoComplete="new-password"
                    required
                  />
                  {confirm && !confirmValid && (
                    <p className="form-error" role="alert">Passwords do not match.</p>
                  )}
                </div>

                {error && (
                  <div className="login-error" role="alert">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="8" cy="8" r="6.5" />
                      <line x1="8" y1="5" x2="8" y2="8.5" />
                      <circle cx="8" cy="11" r="0.5" fill="currentColor" />
                    </svg>
                    <span>{error}</span>
                  </div>
                )}

                <button
                  type="submit"
                  className="btn btn-primary login-btn"
                  disabled={loading || !passwordValid || !confirmValid}
                >
                  {loading ? 'Updating...' : 'Update password'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
