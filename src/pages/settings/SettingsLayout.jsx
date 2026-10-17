import { NavLink } from 'react-router-dom'
import { useAuth } from '../../lib/AuthContext'
import { MODULE_BY_KEY } from '../../lib/permissions'
import '../Settings.css'
import './SettingsLayout.css'

// How the Settings sub-modules are grouped in the side navigation. Each item is a permission module
// (lib/permissions.js), so a person only sees the pages they may open; an empty group is not shown.
const NAV_GROUPS = [
  { label: 'Account', items: ['settings_profile'] },
  { label: 'Workspace', items: ['settings_booking', 'settings_scoring'] },
  { label: 'Social media', items: ['settings_integrations', 'settings_content'] },
  { label: 'Access', items: ['settings_users', 'settings_permissions'] },
]

// Shell around every Settings page: title, side navigation, and the page itself.
export default function SettingsLayout({ children }) {
  const { can } = useAuth()
  const groups = NAV_GROUPS
    .map(g => ({ ...g, items: g.items.filter(can).map(key => MODULE_BY_KEY[key]) }))
    .filter(g => g.items.length > 0)

  return (
    <div className="settings-shell">
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
      </div>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {groups.map(group => (
            <div key={group.label} className="settings-nav-group">
              <div className="settings-nav-heading">{group.label}</div>
              {group.items.map(item => (
                <NavLink
                  key={item.key}
                  to={item.path}
                  className={({ isActive }) => `settings-nav-link ${isActive ? 'active' : ''}`}
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="settings-content">{children}</div>
      </div>
    </div>
  )
}

// Title row at the top of a Settings page. `actions` sits at the right (a primary button, for example).
export function SettingsHeading({ title, hint, actions }) {
  return (
    <div className="settings-page-heading">
      <div>
        <h2 className="settings-page-title">{title}</h2>
        {hint && <p className="settings-page-hint">{hint}</p>}
      </div>
      {actions}
    </div>
  )
}
