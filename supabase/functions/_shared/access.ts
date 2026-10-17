// Who can use a module, according to Settings → Permissions (table role_permissions).
//
// The Edge Functions use this instead of hard-coded role lists to decide who receives an alert and who
// may call them, so the app, the database and the emails all follow the same switch. Admins always have
// every module. Pass the role list the function used before permissions existed as `fallback`: it is
// used only if the table is missing (migration-role-permissions.sql not run yet), so nothing changes
// for a deployment that has not adopted permissions.

// Roles that can open `module`: admin plus every role switched on for it.
export async function rolesWithModule(admin: any, module: string, fallback: string[]): Promise<string[]> {
  const { data, error } = await admin
    .from('role_permissions').select('role').eq('module', module).eq('allowed', true)
  if (error) return fallback
  return ['admin', ...(data || []).map((r: { role: string }) => r.role)]
}

// Active people who can open `module`. `columns` is whatever profile columns the caller needs.
// Deactivated accounts are left out.
// deno-lint-ignore no-explicit-any
export async function staffWithModule(
  admin: any, module: string, fallback: string[], columns = 'id, name, email, role',
): Promise<any[]> {
  const roles = await rolesWithModule(admin, module, fallback)
  const { data } = await admin.from('profiles').select(`${columns}, is_active`).in('role', roles)
  return (data || []).filter((p: { is_active?: boolean | null }) => p.is_active !== false)
}

// Can this signed-in user (by profile id) open `module`?
export async function userHasModule(admin: any, userId: string, module: string, fallback: string[]): Promise<boolean> {
  const { data: profile } = await admin.from('profiles').select('role, is_active').eq('id', userId).maybeSingle()
  if (!profile || profile.is_active === false) return false
  if (profile.role === 'admin') return true
  const { data, error } = await admin
    .from('role_permissions').select('allowed').eq('role', profile.role).eq('module', module).maybeSingle()
  if (error) return fallback.includes(profile.role)
  return !!data?.allowed
}
