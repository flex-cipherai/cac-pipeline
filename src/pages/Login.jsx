import { useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { useNavigate, Link } from 'react-router-dom'
import './Login.css'

const ROLES = [
  { key: 'sales', label: 'Sales Manager' },
  { key: 'marketing', label: 'Marketing Manager' },
  { key: 'admin', label: 'Admin' },
]

export default function Login() {
  const [selectedRole, setSelectedRole] = useState('sales')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { signIn } = useAuth()
  const navigate = useNavigate()

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      await signIn(email, password)
      navigate('/dashboard')
    } catch (err) {
      setError('Invalid email or password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        {/* Logo */}
        <div className="login-logo">
          <svg width="36" height="36" viewBox="0 0 40 40">
            <circle cx="20" cy="20" r="18" fill="#EC3013" />
            <g transform="translate(12, 8)" fill="white">
              <circle cx="8" cy="3" r="2.5" />
              <rect x="6.5" y="5" width="3" height="14" rx="1.5" />
              <circle cx="2" cy="12" r="1.8" />
              <line x1="6.5" y1="12" x2="3.8" y2="12" stroke="white" strokeWidth="2" />
              <circle cx="14" cy="12" r="1.8" />
              <line x1="9.5" y1="12" x2="12.2" y2="12" stroke="white" strokeWidth="2" />
              <circle cx="2" cy="17" r="1.8" />
              <line x1="6.5" y1="17" x2="3.8" y2="17" stroke="white" strokeWidth="2" />
              <circle cx="14" cy="17" r="1.8" />
              <line x1="9.5" y1="17" x2="12.2" y2="17" stroke="white" strokeWidth="2" />
            </g>
          </svg>
          <div className="login-logo-text">
            <span className="login-logo-cipher">CIPHER AI</span>
            <span className="login-logo-consultants">CONSULTANTS</span>
          </div>
        </div>

        {/* Title */}
        <h1 className="login-title">Sign in to Pipeline</h1>
        <p className="login-subtitle">Select your role and sign in to continue.</p>

        {/* Role tabs */}
        <div className="login-role-tabs">
          {ROLES.map(role => (
            <button
              key={role.key}
              className={`login-role-tab ${selectedRole === role.key ? 'active' : ''}`}
              onClick={() => setSelectedRole(role.key)}
              type="button"
            >
              {role.label}
            </button>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label className="form-label" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              className="form-input"
              placeholder="name@cipherai.co.ke"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              className="form-input"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>

          {error && <p className="login-error">{error}</p>}

          <button
            type="submit"
            className="btn btn-primary login-btn"
            disabled={loading}
          >
            {loading ? 'Signing in...' : 'Log In'}
          </button>
        </form>

        {/* Public form link */}
        <Link to="/intake" className="login-intake-link">
          View the public lead intake form →
        </Link>
      </div>
    </div>
  )
}
