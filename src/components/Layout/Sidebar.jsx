import { NavLink } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'
import './Sidebar.css'

const icons = {
  dashboard: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="7" height="7" rx="1.5" />
      <rect x="11" y="2" width="7" height="7" rx="1.5" />
      <rect x="2" y="11" width="7" height="7" rx="1.5" />
      <rect x="11" y="11" width="7" height="7" rx="1.5" />
    </svg>
  ),
  pipeline: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M3 4v12M10 6v10M17 8v8" />
      <circle cx="3" cy="4" r="2" fill="currentColor" stroke="none" />
      <circle cx="10" cy="6" r="2" fill="currentColor" stroke="none" />
      <circle cx="17" cy="8" r="2" fill="currentColor" stroke="none" />
    </svg>
  ),
  leads: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="7.5" cy="6" r="3" />
      <path d="M2 17c0-3 2.5-5.5 5.5-5.5s5.5 2.5 5.5 5.5" />
      <circle cx="14.5" cy="6.5" r="2" />
      <path d="M14.5 11c2 0 3.5 1.5 3.5 3.5" />
    </svg>
  ),
  notifications: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <rect x="2" y="4" width="16" height="12" rx="2" />
      <path d="M2 7l8 5 8-5" />
    </svg>
  ),
  settings: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 2v2.5M10 15.5V18M2 10h2.5M15.5 10H18M4 4l1.8 1.8M14.2 14.2L16 16M4 16l1.8-1.8M14.2 5.8L16 4" />
    </svg>
  ),
  analytics: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <rect x="2" y="11" width="4" height="7" rx="1" />
      <rect x="8" y="6" width="4" height="12" rx="1" />
      <rect x="14" y="2" width="4" height="16" rx="1" />
    </svg>
  ),
  external: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2.5H3.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V10" />
      <path d="M9 2.5h4.5V7" />
      <path d="M13.5 2.5L7.5 8.5" />
    </svg>
  ),
  logout: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.5 15.5H4a1.5 1.5 0 0 1-1.5-1.5V4A1.5 1.5 0 0 1 4 2.5h2.5" />
      <path d="M11.5 12.5L15 9l-3.5-3.5" />
      <line x1="15" y1="9" x2="6.5" y2="9" />
    </svg>
  ),
}

export default function Sidebar({ isOpen, onClose }) {
  const { profile, signOut } = useAuth()
  const role = profile?.role || 'admin'

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
          { to: '/notifications', icon: icons.notifications, label: 'Notifications' },
          { to: '/settings', icon: icons.settings, label: 'Settings' },
        ]
      case 'admin':
      default:
        return [
          { to: '/dashboard', icon: icons.dashboard, label: 'Dashboard' },
          { to: '/pipeline', icon: icons.pipeline, label: 'Pipeline' },
          { to: '/leads', icon: icons.leads, label: 'All Leads' },
          { to: '/notifications', icon: icons.notifications, label: 'Notifications' },
          { to: '/settings', icon: icons.settings, label: 'Settings' },
        ]
    }
  }

  const navItems = getNavItems()

  const roleLabels = {
    admin: 'Admin',
    sales: 'Sales Manager',
    marketing: 'Marketing',
  }

  const initial = profile?.name?.charAt(0)?.toUpperCase() || 'U'

  function handleNavClick() {
    // Close sidebar on mobile after navigation
    if (window.innerWidth <= 768) {
      onClose?.()
    }
  }

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div className="sidebar-overlay" onClick={onClose} aria-hidden="true" />
      )}

      <aside className={`sidebar ${isOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-top">
          {/* Logo */}
          <div className="sidebar-logo">
            <img src="/sdfm-logo-white.png" alt="SDFM Group Limited" className="sidebar-logo-img" />
          </div>

          {/* Navigation */}
          <nav className="sidebar-nav" role="navigation" aria-label="Main navigation">
            {navItems.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={handleNavClick}
                className={({ isActive }) =>
                  `sidebar-nav-item ${isActive ? 'active' : ''}`
                }
              >
                <span className="sidebar-nav-icon">{item.icon}</span>
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
            <div className="sidebar-user-avatar">
              {initial}
            </div>
            <div className="sidebar-user-info">
              <span className="sidebar-user-name">{profile?.name}</span>
              <span className="sidebar-user-role">{roleLabels[role]}</span>
            </div>
            <button
              className="sidebar-logout"
              onClick={signOut}
              title="Sign out"
              aria-label="Sign out"
            >
              {icons.logout}
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}
