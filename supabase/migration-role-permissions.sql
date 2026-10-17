-- ============================================================
-- Role permissions — which modules each role can open (safe to re-run)
--
-- Admins pick, in Settings → Permissions, which modules the sales and marketing
-- roles can open. The app reads these rows to decide which pages a signed-in user
-- can reach and which items the sidebar shows.
--
--   * The admin role always has everything and has no rows (the check constraint
--     below makes sure it can never be locked out by a bad edit).
--   * Seeded with exactly what each role could open before this existed, so nothing
--     changes the moment it is run.
--   * has_module_access() / has_any_module_access() let a database policy follow the same
--     switch. migration-permissions-enforcement.sql uses them to make every module's tables
--     obey this table, so the menu, the pages and the data can never disagree.
--
-- Run in the Supabase SQL Editor BEFORE migration-inquiries.sql and
-- migration-permissions-enforcement.sql.
-- ============================================================

create table if not exists public.role_permissions (
  role text not null check (role in ('sales', 'marketing')),
  module text not null,
  allowed boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  primary key (role, module)
);

drop trigger if exists on_role_permissions_updated on public.role_permissions;
create trigger on_role_permissions_updated
  before update on public.role_permissions
  for each row execute function public.handle_updated_at();

alter table public.role_permissions enable row level security;

-- Everyone signed in can read (the app loads its own role's rows at login).
drop policy if exists "Authenticated users can view role permissions" on public.role_permissions;
create policy "Authenticated users can view role permissions"
  on public.role_permissions for select to authenticated
  using (true);

drop policy if exists "Admins can manage role permissions" on public.role_permissions;
create policy "Admins can manage role permissions"
  on public.role_permissions for all to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));


-- Defaults = what each role could open before this migration.
-- (module keys match src/lib/permissions.js; admin-only modules have no rows)
insert into public.role_permissions (role, module, allowed)
select r.role, m.module, (r.role = any (m.roles))
from (values
  ('dashboard',         array['sales']),
  ('inquiries',         array['sales']),
  ('pipeline',          array['sales']),
  ('leads',             array['sales']),
  ('quotations',        array['sales']),
  ('lead_analytics',    array['marketing']),
  ('notifications',     array['sales']),
  ('social_calendar',   array['marketing']),
  ('social_composer',   array['marketing']),
  ('social_bulk',       array['marketing']),
  ('social_library',    array['marketing']),
  ('social_approvals',  array['marketing']),
  ('social_analytics',  array['marketing']),
  ('website_analytics', array['marketing']),
  ('social_activity',   array['marketing']),
  ('settings_profile',  array['sales']),
  ('settings_booking',  array['sales'])
) as m(module, roles)
cross join (values ('sales'), ('marketing')) as r(role)
on conflict (role, module) do nothing;

-- Settings used to be one switch ('settings'). If an admin had already changed it, carry that choice over
-- to the two Settings pages a non-admin can use, then retire the old row.
update public.role_permissions rp
set allowed = old.allowed
from public.role_permissions old
where old.role = rp.role and old.module = 'settings'
  and rp.module in ('settings_profile', 'settings_booking')
  and rp.updated_by is null and rp.allowed is distinct from old.allowed;
delete from public.role_permissions where module = 'settings';


-- Policy helper: can the signed-in user open this module?
-- security definer so it can read profiles / role_permissions whatever the caller's own rights are.
create or replace function public.has_module_access(p_module text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and coalesce(p.is_active, true)
      and (
        p.role = 'admin'
        or exists (
          select 1 from public.role_permissions rp
          where rp.role = p.role and rp.module = p_module and rp.allowed
        )
      )
  );
$$;

revoke all on function public.has_module_access(text) from public, anon;
grant execute on function public.has_module_access(text) to authenticated;

-- Same, for a page set that several modules share (for example the leads table is used by the
-- dashboard, the pipeline, quotations and others): true if the user has ANY of them.
create or replace function public.has_any_module_access(p_modules text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and coalesce(p.is_active, true)
      and (
        p.role = 'admin'
        or exists (
          select 1 from public.role_permissions rp
          where rp.role = p.role and rp.module = any (p_modules) and rp.allowed
        )
      )
  );
$$;

revoke all on function public.has_any_module_access(text[]) from public, anon;
grant execute on function public.has_any_module_access(text[]) to authenticated;


-- Review
select role, count(*) filter (where allowed) as modules_allowed, count(*) as modules_total
from public.role_permissions group by role order by role;
