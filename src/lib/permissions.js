// Role permissions: which modules each role can open.
//
// Admins edit this in Settings → Permissions; rows live in public.role_permissions
// (supabase/migration-role-permissions.sql). The app uses it for what a signed-in user can reach
// (routes) and see (sidebar). The admin role always has everything and is not stored.
//
// This list is the one place that knows every module: its menu label, path, who had it before
// permissions existed, and which roles the database lets use it. Add a module here, a route in
// App.jsx, and a seed row in the migration.

export const ROLES = [
  { key: 'admin', label: 'Admin', locked: true },
  { key: 'sales', label: 'Sales' },
  { key: 'marketing', label: 'Marketing' },
]

export const EDITABLE_ROLES = ROLES.filter(r => !r.locked)

const ALL_ROLES = ['admin', 'sales', 'marketing']

// defaults: roles that could open it before permissions were configurable (and what the migration seeds).
// dbRoles:  roles whose database rights (row level security) cover what the page does. Granting a role
//           a module outside this list opens the page but its data will not load or save.
// dbFollowsPermissions: the module's tables use has_module_access(), so the database obeys this matrix.
export const MODULE_GROUPS = [
  {
    key: 'pipeline',
    label: 'Sales Pipeline',
    modules: [
      { key: 'dashboard', label: 'Dashboard', path: '/dashboard', defaults: ['admin', 'sales'], dbRoles: ALL_ROLES },
      { key: 'inquiries', label: 'Inquiries', path: '/inquiries', defaults: ['admin', 'sales'], dbFollowsPermissions: true },
      { key: 'pipeline', label: 'Pipeline', path: '/pipeline', defaults: ['admin', 'sales'], dbRoles: ['admin', 'sales'] },
      { key: 'leads', label: 'All Leads', path: '/leads', defaults: ['admin', 'sales'], dbRoles: ['admin', 'sales'] },
      { key: 'quotations', label: 'Quotations', path: '/quotations', defaults: ['admin', 'sales'], dbRoles: ['admin', 'sales'] },
      { key: 'lead_analytics', label: 'Lead Analytics', path: '/analytics', defaults: ['admin', 'marketing'], dbRoles: ALL_ROLES },
      { key: 'notifications', label: 'Notifications', hint: 'Email template editor', path: '/notifications', defaults: ['admin', 'sales'], dbRoles: ['admin', 'sales'] },
    ],
  },
  {
    key: 'social',
    label: 'Social Media',
    modules: [
      { key: 'social_calendar', label: 'Content Calendar', path: '/social/calendar', defaults: ['admin', 'marketing'], dbRoles: ['admin', 'marketing'] },
      { key: 'social_composer', label: 'New Post', path: '/social/composer', defaults: ['admin', 'marketing'], dbRoles: ['admin', 'marketing'] },
      { key: 'social_bulk', label: 'Bulk Scheduler', hint: 'Opened from the Content Calendar', path: '/social/bulk-schedule', defaults: ['admin', 'marketing'], dbRoles: ['admin', 'marketing'], hiddenInMenu: true },
      { key: 'social_library', label: 'Content Library', path: '/social/library', defaults: ['admin', 'marketing'], dbRoles: ['admin', 'marketing'] },
      { key: 'social_approvals', label: 'Approvals', path: '/social/approvals', defaults: ['admin', 'marketing'], dbRoles: ['admin', 'marketing'] },
      { key: 'social_analytics', label: 'Social Analytics', path: '/social/analytics', defaults: ['admin', 'marketing'], dbRoles: ['admin', 'marketing'] },
      { key: 'website_analytics', label: 'Website Analytics', path: '/social/website-analytics', defaults: ['admin', 'marketing'], dbRoles: ['admin', 'marketing'] },
      { key: 'social_activity', label: 'Activity Inbox', path: '/social/activity', defaults: ['admin', 'marketing'], dbRoles: ['admin', 'marketing'] },
    ],
  },
  {
    key: 'general',
    label: 'General',
    modules: [
      // Profile and calendar availability are open to anyone who can reach the page; the user, scoring and
      // permission sections inside it stay admin-only whatever is set here.
      { key: 'settings', label: 'Settings', hint: 'Profile and availability. Users, scoring and permissions stay admin-only', path: '/settings', defaults: ['admin', 'sales'], dbRoles: ALL_ROLES },
    ],
  },
]

export const MODULES = MODULE_GROUPS.flatMap(g => g.modules.map(m => ({ ...m, group: g.key, groupLabel: g.label })))

export const MODULE_BY_KEY = Object.fromEntries(MODULES.map(m => [m.key, m]))

export function defaultAllowed(role, moduleKey) {
  return !!MODULE_BY_KEY[moduleKey]?.defaults.includes(role)
}

// Rows from role_permissions for ONE role -> { moduleKey: boolean }. A module with no row falls back to
// what that role could open before permissions existed.
export function buildAccessMap(role, rows) {
  const stored = new Map((rows || []).map(r => [r.module, !!r.allowed]))
  const map = {}
  for (const m of MODULES) {
    map[m.key] = stored.has(m.key) ? stored.get(m.key) : defaultAllowed(role, m.key)
  }
  return map
}

export function canAccess(role, accessMap, moduleKey) {
  if (role === 'admin') return true
  if (!accessMap) return defaultAllowed(role, moduleKey)
  return !!accessMap[moduleKey]
}

// Where to send someone after login, or when they open a page they cannot: the first module they can
// open, in menu order (so sales land on Dashboard, marketing on Lead Analytics, as before).
// null = they can open nothing.
export function firstAllowedPath(role, accessMap) {
  const first = MODULES.find(m => !m.hiddenInMenu && canAccess(role, accessMap, m.key))
  return first ? first.path : null
}

// True when this role is allowed the module but its database rights do not cover what the page does.
export function needsDatabaseGrant(role, moduleKey) {
  const m = MODULE_BY_KEY[moduleKey]
  if (!m || m.dbFollowsPermissions) return false
  return !!m.dbRoles && !m.dbRoles.includes(role)
}
