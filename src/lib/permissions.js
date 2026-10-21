// Role permissions: which modules each role can open.
//
// Admins edit this in Settings → Permissions; rows live in public.role_permissions
// (supabase/migration-role-permissions.sql). It is enforced in three places that all read the same
// table, so they cannot disagree:
//   1. the app: sidebar and routes (this file, AuthContext, App.jsx)
//   2. the database: row level security policies (supabase/migration-permissions-enforcement.sql)
//   3. the Edge Functions: who receives alerts and who may call them (supabase/functions/_shared/access.ts)
//
// The admin role always has everything and is not stored. A module marked adminOnly is never
// delegable: it is shown in the matrix but cannot be switched on for another role.
//
// This list is the one place that knows every module. Add a module here, a route in App.jsx, a
// sidebar item (or a Settings sub-page), the table rules in the enforcement migration, and a seed row
// in migration-role-permissions.sql.

export const ROLES = [
  { key: 'admin', label: 'Admin', locked: true },
  { key: 'sales', label: 'Sales' },
  { key: 'marketing', label: 'Marketing' },
]

export const EDITABLE_ROLES = ROLES.filter(r => !r.locked)

// defaults:    roles that could open it before permissions were configurable (and what the migration seeds).
// adminOnly:   cannot be given to another role (user management, the permissions screen itself, ...).
// hiddenInMenu: has a page but no sidebar entry of its own (Settings sub-pages share one "Settings" entry).
export const MODULE_GROUPS = [
  {
    key: 'pipeline',
    label: 'Sales Pipeline',
    modules: [
      { key: 'dashboard', label: 'Dashboard', path: '/dashboard', defaults: ['admin', 'sales'] },
      { key: 'inquiries', label: 'Inquiries', path: '/inquiries', defaults: ['admin', 'sales'] },
      { key: 'assessments', label: 'AI Gap Checks', hint: 'Reports from the free assessment tool on the website', path: '/assessments', defaults: ['admin', 'sales'] },
      { key: 'pipeline', label: 'Pipeline', path: '/pipeline', defaults: ['admin', 'sales'] },
      { key: 'leads', label: 'All Leads', path: '/leads', defaults: ['admin', 'sales'] },
      { key: 'quotations', label: 'Quotations', path: '/quotations', defaults: ['admin', 'sales'] },
      { key: 'lead_analytics', label: 'Lead Analytics', path: '/analytics', defaults: ['admin', 'marketing'] },
      { key: 'notifications', label: 'Notifications', hint: 'Email template editor', path: '/notifications', defaults: ['admin', 'sales'] },
    ],
  },
  {
    key: 'social',
    label: 'Social Media',
    modules: [
      { key: 'social_calendar', label: 'Content Calendar', path: '/social/calendar', defaults: ['admin', 'marketing'] },
      { key: 'social_composer', label: 'New Post', path: '/social/composer', defaults: ['admin', 'marketing'] },
      { key: 'social_bulk', label: 'Bulk Scheduler', hint: 'Opened from the Content Calendar', path: '/social/bulk-schedule', defaults: ['admin', 'marketing'], hiddenInMenu: true },
      { key: 'social_library', label: 'Content Library', path: '/social/library', defaults: ['admin', 'marketing'] },
      { key: 'social_approvals', label: 'Approvals', hint: 'Deciding on a post stays an admin action', path: '/social/approvals', defaults: ['admin', 'marketing'] },
      { key: 'social_analytics', label: 'Social Analytics', path: '/social/analytics', defaults: ['admin', 'marketing'] },
      { key: 'website_analytics', label: 'Website Analytics', path: '/social/website-analytics', defaults: ['admin', 'marketing'] },
      { key: 'social_activity', label: 'Activity Inbox', path: '/social/activity', defaults: ['admin', 'marketing'] },
    ],
  },
  {
    key: 'settings',
    label: 'Settings',
    modules: [
      { key: 'settings_profile', label: 'My profile', hint: 'Name, phone, timezone and password', path: '/settings/profile', defaults: ['admin', 'sales'], hiddenInMenu: true },
      { key: 'settings_booking', label: 'Booking & availability', hint: 'Call slots and booking rules', path: '/settings/booking', defaults: ['admin', 'sales'], hiddenInMenu: true },
      { key: 'settings_users', label: 'Users', path: '/settings/users', defaults: ['admin'], adminOnly: true, hiddenInMenu: true },
      { key: 'settings_permissions', label: 'Permissions', path: '/settings/permissions', defaults: ['admin'], adminOnly: true, hiddenInMenu: true },
      { key: 'settings_integrations', label: 'Integrations', hint: 'LinkedIn and Google Search Console', path: '/settings/integrations', defaults: ['admin'], adminOnly: true, hiddenInMenu: true },
      { key: 'settings_content', label: 'Content defaults', hint: 'Posting defaults, app URL and hashtag sets', path: '/settings/content', defaults: ['admin'], adminOnly: true, hiddenInMenu: true },
      { key: 'settings_assessment', label: 'Assessment tool', hint: 'Questions, ROI assumptions, AI model and limits for the free AI Gap Check', path: '/settings/assessment', defaults: ['admin'], adminOnly: true, hiddenInMenu: true },
      { key: 'settings_scoring', label: 'Scoring', path: '/settings/scoring', defaults: ['admin'], adminOnly: true, hiddenInMenu: true },
    ],
  },
]

export const MODULES = MODULE_GROUPS.flatMap(g => g.modules.map(m => ({ ...m, group: g.key, groupLabel: g.label })))

export const MODULE_BY_KEY = Object.fromEntries(MODULES.map(m => [m.key, m]))

// The modules an admin can actually switch on or off per role (the matrix's editable rows).
export const DELEGABLE_MODULES = MODULES.filter(m => !m.adminOnly)

export const SETTINGS_MODULES = MODULES.filter(m => m.group === 'settings')

export function defaultAllowed(role, moduleKey) {
  return !!MODULE_BY_KEY[moduleKey]?.defaults.includes(role)
}

// Rows from role_permissions for ONE role -> { moduleKey: boolean }. A module with no row falls back to
// what that role could open before permissions existed. Admin-only modules are always false here.
export function buildAccessMap(role, rows) {
  const stored = new Map((rows || []).map(r => [r.module, !!r.allowed]))
  const map = {}
  for (const m of MODULES) {
    if (m.adminOnly) map[m.key] = false
    else map[m.key] = stored.has(m.key) ? stored.get(m.key) : defaultAllowed(role, m.key)
  }
  return map
}

export function canAccess(role, accessMap, moduleKey) {
  if (role === 'admin') return true
  const m = MODULE_BY_KEY[moduleKey]
  if (!m || m.adminOnly) return false
  if (!accessMap) return defaultAllowed(role, moduleKey)
  return !!accessMap[moduleKey]
}

// Where to send someone after login, or when they open a page they cannot: the first module with its own
// menu entry they can open, in menu order (so sales land on Dashboard, marketing on Lead Analytics, as
// before). Settings pages come last. null = they can open nothing.
export function firstAllowedPath(role, accessMap) {
  const open = MODULES.filter(m => canAccess(role, accessMap, m.key))
  const first = open.find(m => !m.hiddenInMenu) || open[0]
  return first ? first.path : null
}
