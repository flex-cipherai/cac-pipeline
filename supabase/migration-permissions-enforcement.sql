-- ============================================================
-- Permissions enforcement — make the database obey Settings → Permissions
--
-- Until now each module's tables carried their own hard-coded role lists ("role in ('admin',
-- 'marketing')"), so the Permissions matrix could hide a module but not unlock or lock its data.
-- This migration replaces those policies, table by table, with rules that ask
-- has_module_access() / has_any_module_access(), the same table the app and the Edge Functions read.
-- After it, switching a module on for a role in Settings is enough: the menu, the page and the
-- data all follow.
--
-- WHAT IT DOES
--   * For every table listed in section 3 it DROPS ALL existing policies (including any made by
--     hand in the dashboard, such as the old permissive "auth_update_leads") and creates the rules
--     below. Rows are untouched; only who may see or change them.
--   * Redefines wa_is_content_team() (used by every Website Analytics report) to mean "can open
--     Website Analytics".
--   * Replaces the content-library storage policies the same way.
--   * Records permissions_enforced = true in system_settings; Settings → Permissions reads it.
--
-- WHAT STAYS ROLE-BASED, ON PURPOSE (not delegable)
--   * user management (profiles), the permissions table itself, connected accounts (LinkedIn),
--     and deciding on a post for approval: admin only.
--   * Each person's own in-app notifications: their own rows.
--
-- BEFORE YOU RUN IT
--   1. migration-role-permissions.sql, then migration-booking-lockdown.sql (this refuses to run
--      while any managed table still allows anonymous access, because dropping those policies
--      would silently change what the public site can do).
--   2. Read the rules in section 3. With the original seed, every role keeps exactly the access it
--      has today, with three deliberate tightenings: a role with no lead-related module can no
--      longer read the leads tables; sales can no longer write settings other than the booking
--      ones; and the leads/quotation/template tables are no longer open to every signed-in user.
--
-- Safe to re-run. Run in the Supabase SQL Editor.
-- ============================================================


-- 1. Pre-flight -----------------------------------------------------------------

do $preflight$
declare
  managed text[] := array[
    'leads', 'lead_notes', 'lead_stage_history', 'booked_slots', 'calendar_availability', 'system_settings',
    'email_templates', 'quotations', 'quotation_items',
    'posts', 'post_assets', 'content_assets', 'content_campaigns', 'content_pillars', 'hashtag_sets',
    'post_approval_history', 'analytics_snapshots', 'activity_events', 'connected_accounts',
    'in_app_notifications'
  ];
  offenders text;
begin
  if to_regclass('public.role_permissions') is null or to_regprocedure('public.has_any_module_access(text[])') is null then
    raise exception 'Run migration-role-permissions.sql first (it creates role_permissions and has_any_module_access).';
  end if;

  select string_agg(format('%s.%s [%s]', tablename, policyname, array_to_string(roles, ',')), E'\n  ')
    into offenders
  from pg_policies
  where schemaname = 'public'
    and tablename = any (managed)
    and (roles && array['anon', 'public']::name[]);

  if offenders is not null then
    raise exception E'These policies allow anonymous access, so enforcement was NOT applied:\n  %\nRun migration-booking-lockdown.sql first (it removes them), or drop them by hand if you know the public site does not use them, then run this again.', offenders;
  end if;
end
$preflight$;


-- 2. Helpers (removed again at the end) ----------------------------------------

-- 'public.has_any_module_access(array[''a'',''b''])' for a list of module keys.
create or replace function public._perm_mods(variadic p_modules text[])
returns text
language sql
immutable
as $$
  select 'public.has_any_module_access(array[' ||
         (select string_agg(quote_literal(m), ', ') from unnest(p_modules) m) || '])';
$$;

-- Replace ALL policies on a table with one rule per command. NULL = nobody (except via service role).
create or replace function public._apply_module_policies(
  p_table text, p_select text, p_insert text, p_update text, p_delete text
)
returns void
language plpgsql
as $$
declare
  r record;
begin
  if to_regclass(format('public.%I', p_table)) is null then
    raise notice 'Skipping %: table does not exist here', p_table;
    return;
  end if;

  for r in select policyname from pg_policies where schemaname = 'public' and tablename = p_table loop
    execute format('drop policy %I on public.%I', r.policyname, p_table);
  end loop;

  execute format('alter table public.%I enable row level security', p_table);

  if p_select is not null then
    execute format('create policy %I on public.%I for select to authenticated using (%s)',
                   'Module access: view', p_table, p_select);
  end if;
  if p_insert is not null then
    execute format('create policy %I on public.%I for insert to authenticated with check (%s)',
                   'Module access: add', p_table, p_insert);
  end if;
  if p_update is not null then
    execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)',
                   'Module access: change', p_table, p_update, p_update);
  end if;
  if p_delete is not null then
    execute format('create policy %I on public.%I for delete to authenticated using (%s)',
                   'Module access: delete', p_table, p_delete);
  end if;
end
$$;


-- 3. The rules ------------------------------------------------------------------
-- Which modules' pages touch each table (from the app's own queries). Module keys: src/lib/permissions.js.

do $rules$
declare
  is_admin   text := $x$exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')$x$;

  -- Sales side
  leads_read text := public._perm_mods('dashboard', 'pipeline', 'leads', 'quotations', 'lead_analytics', 'inquiries', 'social_analytics');
  leads_edit text := public._perm_mods('pipeline', 'leads');
  leads_drop text := public._perm_mods('leads');
  history_rd text := public._perm_mods('dashboard', 'pipeline', 'leads');
  slots_rd   text := public._perm_mods('dashboard', 'pipeline', 'leads', 'settings_booking');
  booking    text := public._perm_mods('settings_booking');
  templates  text := public._perm_mods('notifications');
  quotes     text := public._perm_mods('quotations');

  -- Social side
  content    text := public._perm_mods('social_calendar', 'social_composer', 'social_bulk', 'social_library', 'social_approvals');
  content_rd text := public._perm_mods('social_calendar', 'social_composer', 'social_bulk', 'social_library', 'social_approvals', 'social_analytics');
  accounts_rd text := public._perm_mods('social_calendar', 'social_composer', 'social_bulk', 'social_library', 'social_approvals', 'social_analytics', 'social_activity');
  analytics  text := public._perm_mods('social_analytics');
  activity   text := public._perm_mods('social_activity');

  -- The only system_settings keys a non-admin with Booking & availability may change.
  booking_keys text := $x$array['booking_window_days', 'booking_min_notice_hours', 'booking_duration_minutes',
    'booking_buffer_minutes', 'reminder_hours_before_call', 'team_timezone', 'meeting_link', 'whatsapp_number']$x$;
  settings_write text;
begin
  settings_write := format('(%s) or (public.has_module_access(''settings_booking'') and key = any (%s))', is_admin, booking_keys);

  --                                       table                   view         add         change      delete
  -- Leads and their history
  perform public._apply_module_policies('leads',                 leads_read,  leads_edit, leads_edit, leads_drop);
  perform public._apply_module_policies('lead_notes',            leads_edit,  leads_edit, null,       null);
  perform public._apply_module_policies('lead_stage_history',    history_rd,  leads_edit, null,       null);
  perform public._apply_module_policies('booked_slots',          slots_rd,    leads_edit, null,       null);

  -- Booking setup and shared settings
  perform public._apply_module_policies('calendar_availability', booking,     booking,    booking,    booking);
  perform public._apply_module_policies('system_settings',       'auth.uid() is not null', settings_write, settings_write, settings_write);

  -- Email templates and quotations
  perform public._apply_module_policies('email_templates',       templates,   templates,  templates,  templates);
  perform public._apply_module_policies('quotations',            quotes,      quotes,     quotes,     quotes);
  perform public._apply_module_policies('quotation_items',       quotes,      quotes,     quotes,     quotes);

  -- Social media content
  perform public._apply_module_policies('posts',                 content_rd,  content,    content,    content);
  perform public._apply_module_policies('post_assets',           content,     content,    content,    content);
  perform public._apply_module_policies('content_assets',        content,     content,    content,    content);
  perform public._apply_module_policies('content_campaigns',     content_rd,  content,    content,    content);
  perform public._apply_module_policies('content_pillars',       content,     content,    content,    content);
  perform public._apply_module_policies('hashtag_sets',          content,     content,    content,    content);
  perform public._apply_module_policies('post_approval_history', content,
    format('(action = ''submitted'' and (%s)) or (action in (''approved'', ''changes_requested'', ''rejected'') and (%s))', content, is_admin),
    null, null);
  perform public._apply_module_policies('analytics_snapshots',   analytics,   analytics,  analytics,  analytics);
  perform public._apply_module_policies('activity_events',       activity,    activity,   activity,   activity);
  perform public._apply_module_policies('connected_accounts',    accounts_rd, is_admin,   is_admin,   is_admin);

  -- Each person's own notifications; anyone working on social content can notify the team
  perform public._apply_module_policies('in_app_notifications',  'user_id = auth.uid()', accounts_rd, 'user_id = auth.uid()', null);
end
$rules$;


-- 4. Website Analytics --------------------------------------------------------
-- Every report function and the seo_* / web_* read policies already call this one helper.
create or replace function public.wa_is_content_team()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_module_access('website_analytics');
$$;


-- 5. Content library files (storage) ----------------------------------------------

do $storage$
declare
  r record;
  rule text := public._perm_mods('social_calendar', 'social_composer', 'social_bulk', 'social_library', 'social_approvals');
begin
  if to_regclass('storage.objects') is null then
    raise notice 'Skipping content library: storage schema not found';
    return;
  end if;

  -- every policy that mentions this bucket, whatever it was called
  for r in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and coalesce(qual, '') || coalesce(with_check, '') like '%content-library%'
  loop
    execute format('drop policy %I on storage.objects', r.policyname);
  end loop;

  execute format($p$create policy "Module access: library files view" on storage.objects for select to authenticated
    using (bucket_id = 'content-library' and %s)$p$, rule);
  execute format($p$create policy "Module access: library files add" on storage.objects for insert to authenticated
    with check (bucket_id = 'content-library' and %s)$p$, rule);
  execute format($p$create policy "Module access: library files change" on storage.objects for update to authenticated
    using (bucket_id = 'content-library' and %s)$p$, rule);
  execute format($p$create policy "Module access: library files delete" on storage.objects for delete to authenticated
    using (bucket_id = 'content-library' and %s)$p$, rule);
end
$storage$;


-- 6. Mark it applied (Settings → Permissions shows a warning until this is true) -----------

insert into public.system_settings (key, value) values ('permissions_enforced', 'true')
on conflict (key) do update set value = 'true';


-- 7. Clean up ------------------------------------------------------------------------

drop function public._apply_module_policies(text, text, text, text, text);
drop function public._perm_mods(text[]);


-- Review: every managed table should show only "Module access: ..." policies.
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and policyname like 'Module access:%'
order by tablename, cmd;
