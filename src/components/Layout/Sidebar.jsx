import { NavLink } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'
import './Sidebar.css'

// Inline SVG icons (clean, minimal)
const icons = {
  dashboard: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="1" width="6.5" height="6.5" rx="1" />
      <rect x="10.5" y="1" width="6.5" height="6.5" rx="1" />
      <rect x="1" y="10.5" width="6.5" height="6.5" rx="1" />
      <rect x="10.5" y="10.5" width="6.5" height="6.5" rx="1" />
    </svg>
  ),
  pipeline: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="3" y1="3" x2="3" y2="15" />
      <line x1="9" y1="5" x2="9" y2="15" />
      <line x1="15" y1="7" x2="15" y2="15" />
      <circle cx="3" cy="3" r="1.5" fill="currentColor" />
      <circle cx="9" cy="5" r="1.5" fill="currentColor" />
      <circle cx="15" cy="7" r="1.5" fill="currentColor" />
    </svg>
  ),
  leads: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="7" cy="5.5" r="3" />
      <path d="M1.5 15.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <circle cx="13.5" cy="6" r="2" />
      <path d="M13.5 10.5c2 0 3.5 1.2 3.5 3" />
    </svg>
  ),
  settings: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="9" cy="9" r="2.5" />
      <path d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.1 3.1l1.4 1.4M13.5 13.5l1.4 1.4M3.1 14.9l1.4-1.4M13.5 4.5l1.4-1.4" />
    </svg>
  ),
  analytics: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="10" width="3" height="6" rx="0.5" />
      <rect x="7.5" y="6" width="3" height="10" rx="0.5" />
      <rect x="13" y="2" width="3" height="14" rx="0.5" />
    </svg>
  ),
  external: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M5.5 2H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8.5" />
      <path d="M8 2h4v4" />
      <path d="M12 2L6.5 7.5" />
    </svg>
  ),
  logout: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M6 14H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h3" />
      <path d="M10.5 11.5L14 8l-3.5-3.5" />
      <line x1="14" y1="8" x2="6" y2="8" />
    </svg>
  ),
}

export default function Sidebar() {
  const { profile, signOut } = useAuth()
  const role = profile?.role || 'admin'

  // Navigation items based on role
  const getNavItems = () => {
    switch (role) {
      case 'marketing':
        return [
          { to: '/analytics', icon: icons.analytics, label: 'Analytics' },
        ]
      case 'sales':
        return [
          { to: '/dashboard', icon: icons.dashboard, label: 'Dashboard' },
          { to: '/pipeline', icon: icons.pipeline, label: 'Pipeline' },
          { to: '/leads', icon: icons.leads, label: 'All Leads' },
        ]
      case 'admin':
      default:
        return [
          { to: '/dashboard', icon: icons.dashboard, label: 'Dashboard' },
          { to: '/pipeline', icon: icons.pipeline, label: 'Pipeline' },
          { to: '/leads', icon: icons.leads, label: 'All Leads' },
          { to: '/settings', icon: icons.settings, label: 'Settings' },
        ]
    }
  }

  const navItems = getNavItems()

  // Role display name
  const roleLabels = {
    admin: 'Admin',
    sales: 'Sales Manager',
    marketing: 'Marketing Manager',
  }

  // Get first initial for avatar
  const initial = profile?.name?.charAt(0)?.toUpperCase() || 'U'

  // Avatar color based on role
  const avatarColors = {
    admin: 'var(--cac-red)',
    sales: '#2563eb',
    marketing: 'var(--cac-red)',
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        {/* Logo */}
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">
            <svg width="28" height="28" viewBox="0 0 40 40">
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
          </div>
          <span className="sidebar-logo-text">PIPELINE</span>
        </div>

        {/* Role selector (display only) */}
        <div className="sidebar-role">
          <span className="sidebar-role-label">ROLE</span>
          <div className="sidebar-role-value">
            {roleLabels[role]}
          </div>
        </div>

        {/* Navigation */}
        <nav className="sidebar-nav">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `sidebar-nav-item ${isActive ? 'active' : ''}`
              }
            >
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="sidebar-bottom">
        {/* Lead intake form link */}
        <a
          href="/intake"
          target="_blank"
          rel="noopener noreferrer"
          className="sidebar-intake-link"
        >
          {icons.external}
          <span>Lead Intake Form</span>
        </a>

        {/* User info */}
        <div className="sidebar-user">
          <div
            className="sidebar-user-avatar"
            style={{ background: avatarColors[role] }}
          >
            {initial}
          </div>
          <div className="sidebar-user-info">
            <span className="sidebar-user-name">{profile?.name}</span>
            <span className="sidebar-user-role">{roleLabels[role]}</span>
          </div>
          <button className="sidebar-logout" onClick={signOut} title="Sign out">
            {icons.logout}
          </button>
        </div>
      </div>
    </aside>
  )
}
