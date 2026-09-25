import { useState, useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'
import './Sidebar.css'

const icons = {
  salesModule: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 3h15l-5.5 7.5v5L8 17v-6.5L2.5 3z" />
    </svg>
  ),
  socialModule: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 4h14a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H9l-4 3.5V13H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
    </svg>
  ),
  chevron: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5.5l3 3 3-3" />
    </svg>
  ),
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
  quotation: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 2h10v15l-2-1.5-1.5 1.5-1.5-1.5-1.5 1.5-1.5-1.5L5 17V2z" />
      <path d="M7.5 6h5M7.5 9h5M7.5 12h3" />
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
  compose: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 3l4 4-9.5 9.5L3 18l1.5-4.5L13 3z" />
    </svg>
  ),
  library: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="12" height="12" rx="1.5" />
      <path d="M6 17.5h10a1.5 1.5 0 0 0 1.5-1.5V6" />
    </svg>
  ),
  calendarIcon: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="16" height="14" rx="2" />
      <path d="M2 8h16M6 2v4M14 2v4" />
    </svg>
  ),
  approvals: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 10l3.5 3.5L16 5" />
    </svg>
  ),
  activity: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 10h3l2-6 4 12 2-6h5" />
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

// The system has two modules — Sales Pipeline Management and Social Media
// Management — each rendered as a collapsible group in the sidebar. Items
// are filtered per role below; a group with no items for the current role
// is omitted entirely rather than shown empty.
const MODULES = [
  {
    key: 'pipeline',
    label: 'Sales Pipeline',
    icon: icons.salesModule,
    items: [
      { to: '/dashboard', icon: icons.dashboard, label: 'Dashboard', roles: ['admin', 'sales'] },
      { to: '/pipeline', icon: icons.pipeline, label: 'Pipeline', roles: ['admin', 'sales'] },
      { to: '/leads', icon: icons.leads, label: 'All Leads', roles: ['admin', 'sales'] },
      { to: '/quotations', icon: icons.quotation, label: 'Quotations', roles: ['admin', 'sales'] },
      { to: '/analytics', icon: icons.analytics, label: 'Lead Analytics', roles: ['admin', 'marketing'] },
      { to: '/notifications', icon: icons.notifications, label: 'Notifications', roles: ['admin', 'sales'] },
    ],
  },
  {
    key: 'social',
    label: 'Social Media',
    icon: icons.socialModule,
    items: [
      { to: '/social/calendar', icon: icons.calendarIcon, label: 'Content Calendar', roles: ['admin', 'marketing'] },
      { to: '/social/composer', icon: icons.compose, label: 'New Post', roles: ['admin', 'marketing'] },
      { to: '/social/library', icon: icons.library, label: 'Content Library', roles: ['admin', 'marketing'] },
      { to: '/social/approvals', icon: icons.approvals, label: 'Approvals', roles: ['admin', 'marketing'] },
      { to: '/social/analytics', icon: icons.analytics, label: 'Social Analytics', roles: ['admin', 'marketing'] },
      { to: '/social/activity', icon: icons.activity, label: 'Activity Inbox', roles: ['admin', 'marketing'] },
    ],
  },
]

// Items that don't belong to either module.
const STANDALONE_ITEMS = [
  { to: '/settings', icon: icons.settings, label: 'Settings', roles: ['admin', 'sales'] },
]

const roleLabels = {
  admin: 'Admin',
  sales: 'Sales Manager',
  marketing: 'Marketing',
}

export default function Sidebar({ isOpen, onClose }) {
  const { profile, signOut } = useAuth()
  const location = useLocation()
  const role = profile?.role || 'admin'

  const modules = MODULES
    .map(m => ({ ...m, items: m.items.filter(i => i.roles.includes(role)) }))
    .filter(m => m.items.length > 0)
  const standaloneItems = STANDALONE_ITEMS.filter(i => i.roles.includes(role))

  const [openModule, setOpenModule] = useState(null)

  // Auto-expand whichever module contains the page the user is currently on.
  useEffect(() => {
    const active = modules.find(m => m.items.some(i => location.pathname.startsWith(i.to)))
    if (active) setOpenModule(active.key)
  }, [location.pathname])

  function toggleModule(key) {
    setOpenModule(prev => (prev === key ? null : key))
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
            {modules.map(module => {
              const isOpen = openModule === module.key
              const hasActiveChild = module.items.some(i => location.pathname.startsWith(i.to))
              return (
                <div key={module.key} className="sidebar-module">
                  <button
                    type="button"
                    className={`sidebar-nav-item sidebar-module-toggle ${hasActiveChild ? 'active' : ''}`}
                    onClick={() => toggleModule(module.key)}
                    aria-expanded={isOpen}
                  >
                    <span className="sidebar-nav-icon">{module.icon}</span>
                    <span className="sidebar-module-label">{module.label}</span>
                    <span className={`sidebar-module-chevron ${isOpen ? 'open' : ''}`}>{icons.chevron}</span>
                  </button>
                  <div className={`sidebar-submenu-wrap ${isOpen ? 'open' : ''}`}>
                    <div className="sidebar-submenu">
                      {module.items.map(item => (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          onClick={handleNavClick}
                          className={({ isActive }) =>
                            `sidebar-nav-item sidebar-submenu-item ${isActive ? 'active' : ''}`
                          }
                        >
                          <span className="sidebar-nav-icon">{item.icon}</span>
                          <span>{item.label}</span>
                        </NavLink>
                      ))}
                    </div>
                  </div>
                </div>
              )
            })}

            {standaloneItems.length > 0 && <div className="sidebar-nav-divider" />}

            {standaloneItems.map(item => (
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
