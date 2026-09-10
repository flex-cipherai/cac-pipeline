import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useNavigate, Link } from 'react-router-dom'
import './Login.css'

export default function Login() {
  const [view, setView] = useState('login') // 'login' | 'forgot' | 'forgot-sent'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [emailTouched, setEmailTouched] = useState(false)
  const [passwordTouched, setPasswordTouched] = useState(false)
  const { signIn } = useAuth()
  const navigate = useNavigate()

  // Validation
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  const passwordValid = password.length >= 6

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      await signIn(email, password)
      navigate('/dashboard')
    } catch (err) {
      if (err.message === 'ACCOUNT_DEACTIVATED') {
        setError('Your account has been deactivated. Contact your administrator to restore access.')
      } else {
        setError('Invalid email or password. Check your credentials and try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleForgotPassword(e) {
    e.preventDefault()
    if (!emailValid) return
    setError('')
    setLoading(true)

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      if (error) throw error
      setView('forgot-sent')
    } catch (err) {
      setError('Could not send reset email. Please check the address and try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      {/* Left panel — branding */}
      <div className="login-brand">
        <div className="login-brand-content">
          <div className="login-brand-logo">
            <img src="/sdfm-logo.png" alt="SDFM Group Limited" className="login-brand-logo-img" />
          </div>
          <h2 className="login-brand-name">Sales Management Pipeline</h2>
          <p className="login-brand-tagline">Transforming Kenyan Businesses</p>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="login-form-panel">
        <div className="login-form-container">

          {/* LOGIN VIEW */}
          {view === 'login' && (
            <>
              <h1 className="login-title">Sign in</h1>
              <p className="login-subtitle">Enter your credentials to access the pipeline.</p>

              <form onSubmit={handleLogin} className="login-form" noValidate>
                <div className="form-group">
                  <label className="form-label" htmlFor="email">Email</label>
                  <input
                    id="email"
                    type="email"
                    className={`form-input ${emailTouched && !emailValid && email ? 'form-input-error' : ''}`}
                    placeholder="name@sdfmgroup.co.ke"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    onBlur={() => setEmailTouched(true)}
                    autoComplete="email"
                    required
                  />
                  {emailTouched && !emailValid && email && (
                    <p className="form-error" id="email-error" role="alert">Enter a valid email address.</p>
                  )}
                </div>

                <div className="form-group">
                  <div className="login-password-header">
                    <label className="form-label" htmlFor="password">Password</label>
                    <button
                      type="button"
                      className="login-forgot-link"
                      onClick={() => { setError(''); setView('forgot') }}
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="login-password-wrap">
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      className={`form-input ${passwordTouched && !passwordValid && password ? 'form-input-error' : ''}`}
                      placeholder="Enter your password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      onBlur={() => setPasswordTouched(true)}
                      autoComplete="current-password"
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
                  {passwordTouched && !passwordValid && password && (
                    <p className="form-error" id="password-error" role="alert">Password must be at least 6 characters.</p>
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
                  disabled={loading || !emailValid || !passwordValid}
                >
                  {loading ? 'Signing in...' : 'Sign in'}
                </button>
              </form>

              <div className="login-footer">
                <Link to="/intake" className="login-intake-link">
                  View the public lead intake form →
                </Link>
              </div>
            </>
          )}

          {/* FORGOT PASSWORD VIEW */}
          {view === 'forgot' && (
            <>
              <h1 className="login-title">Reset your password</h1>
              <p className="login-subtitle">
                Enter your email address and we'll send you a link to reset your password.
              </p>

              <form onSubmit={handleForgotPassword} className="login-form" noValidate>
                <div className="form-group">
                  <label className="form-label" htmlFor="reset-email">Email</label>
                  <input
                    id="reset-email"
                    type="email"
                    className="form-input"
                    placeholder="name@sdfmgroup.co.ke"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    autoComplete="email"
                    autoFocus
                    required
                  />
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
                  disabled={loading || !emailValid}
                >
                  {loading ? 'Sending...' : 'Send reset link'}
                </button>
              </form>

              <button
                className="login-back-link"
                onClick={() => { setError(''); setView('login') }}
              >
                ← Back to sign in
              </button>
            </>
          )}

          {/* FORGOT PASSWORD SENT CONFIRMATION */}
          {view === 'forgot-sent' && (
            <div className="login-sent">
              <div className="login-sent-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--sdfm-red)" strokeWidth="1.5">
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <path d="M2 4l10 9 10-9" />
                </svg>
              </div>
              <h1 className="login-title">Check your email</h1>
              <p className="login-subtitle">
                We've sent a password reset link to <strong>{email}</strong>. 
                Check your inbox and follow the instructions to reset your password.
              </p>
              <button
                className="login-back-link"
                onClick={() => { setError(''); setView('login') }}
              >
                ← Back to sign in
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
