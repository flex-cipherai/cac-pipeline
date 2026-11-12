-- ============================================================
-- Ospod waitlist: signups from the Ospod landing pages (safe to re-run)
--
-- Ospod is a separate product SDFM is testing demand for. Its landing pages (two: podcasters and studios)
-- collect an email plus four qualifying answers. The pages never touch the database: they call the
-- ospod-waitlist Edge Function (service role), which calls ospod_waitlist_join() below. Staff read and work
-- the signups in the CRM under Ospod, Ospod Waitlist.
--
--   ospod_waitlist_signups   one row per person (one per email address)
--
-- Founding 500: member_no is the order people joined, 1, 2, 3 ... The first 500 are "founding members"
-- (the offer on the page). ospod_waitlist_join() numbers people under a lock, so two people joining at the
-- same moment can never get the same number or push the count past the cap by a race.
--
-- Access follows Settings, Permissions (module 'ospod_waitlist') through has_module_access(). Admin always
-- has it; sales and marketing are off until an admin switches it on. Staff may change status and notes only.
-- Only an admin can delete (for "please delete my details" requests).
--
-- Run in the Supabase SQL Editor after migration-role-permissions.sql.
-- ============================================================


-- 1. Signups ------------------------------------------------------------------

create table if not exists public.ospod_waitlist_signups (
  id uuid primary key default gen_random_uuid(),

  -- Join order. The first 500 are founding members.
  member_no integer not null unique,

  email text not null,
  -- One signup per person: case and surrounding spaces do not make a new person.
  email_key text generated always as (lower(btrim(email))) stored,

  -- Which page they signed up on.
  variant text not null check (variant in ('indie', 'studios')),

  -- The four answers, exactly as the chips read on the page (the Edge Function checks them against the
  -- allowed lists, so a wording change on the page is a one-line change there, not a migration).
  role text not null,
  shows text not null,
  episodes text not null,
  spend text not null,

  -- Attribution: which ad brought them (utm_content holds the variant tag: ig_30, ig_15, li_30, li_15).
  page_path text,
  referrer text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  ip_hash text,

  -- Follow-up
  status text not null default 'new'
    check (status in ('new', 'contacted', 'call_booked', 'interviewed', 'not_a_fit')),
  notes text,

  -- When the team alert email went out (null = it did not, e.g. the email service was down).
  notified_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ospod_waitlist_email_key_idx on public.ospod_waitlist_signups (email_key);
create index if not exists ospod_waitlist_created_idx on public.ospod_waitlist_signups (created_at desc);
create index if not exists ospod_waitlist_variant_idx on public.ospod_waitlist_signups (variant, created_at desc);

drop trigger if exists on_ospod_waitlist_updated on public.ospod_waitlist_signups;
create trigger on_ospod_waitlist_updated
  before update on public.ospod_waitlist_signups
  for each row execute function public.handle_updated_at();


-- 2. Row level security -------------------------------------------------------
-- No insert policy: only the Edge Function (service role) adds people.

alter table public.ospod_waitlist_signups enable row level security;

drop policy if exists "Module access: view ospod waitlist" on public.ospod_waitlist_signups;
create policy "Module access: view ospod waitlist"
  on public.ospod_waitlist_signups for select to authenticated
  using (public.has_module_access('ospod_waitlist'));

drop policy if exists "Module access: update ospod waitlist" on public.ospod_waitlist_signups;
create policy "Module access: update ospod waitlist"
  on public.ospod_waitlist_signups for update to authenticated
  using (public.has_module_access('ospod_waitlist'))
  with check (public.has_module_access('ospod_waitlist'));

drop policy if exists "Admins can delete ospod waitlist" on public.ospod_waitlist_signups;
create policy "Admins can delete ospod waitlist"
  on public.ospod_waitlist_signups for delete to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- Staff may only change status and notes; everything else is what the person submitted.
revoke update on public.ospod_waitlist_signups from authenticated;
grant update (status, notes) on public.ospod_waitlist_signups to authenticated;


-- 3. Joining: one atomic function --------------------------------------------
-- Called only by the Edge Function. Returns jsonb:
--   already   true if this email was on the list (nothing is changed, first answers and first source stay)
--   member_no their number
--   founding  member_no <= cap
--   claimed   people on the list, never above the cap (what the page's meter shows)

create or replace function public.ospod_waitlist_join(p jsonb, p_cap integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_key text := lower(btrim(coalesce(p->>'email', '')));
  v_row public.ospod_waitlist_signups;
  v_count integer;
  v_next integer;
begin
  if v_key = '' then
    raise exception 'email is required';
  end if;

  -- One joiner at a time, so numbers are gap-free and unique.
  perform pg_advisory_xact_lock(hashtext('ospod_waitlist_join'));

  select * into v_row from public.ospod_waitlist_signups where email_key = v_key;
  if found then
    select count(*) into v_count from public.ospod_waitlist_signups;
    return jsonb_build_object(
      'already', true, 'member_no', v_row.member_no,
      'founding', v_row.member_no <= p_cap, 'claimed', least(v_count, p_cap));
  end if;

  select coalesce(max(member_no), 0) + 1 into v_next from public.ospod_waitlist_signups;

  insert into public.ospod_waitlist_signups (
    member_no, email, variant, role, shows, episodes, spend,
    page_path, referrer, utm_source, utm_medium, utm_campaign, utm_content, utm_term, ip_hash
  ) values (
    v_next, btrim(p->>'email'), p->>'variant', p->>'role', p->>'shows', p->>'episodes', p->>'spend',
    nullif(left(p->>'page_path', 200), ''), nullif(left(p->>'referrer', 500), ''),
    nullif(left(p->>'utm_source', 120), ''), nullif(left(p->>'utm_medium', 120), ''),
    nullif(left(p->>'utm_campaign', 120), ''), nullif(left(p->>'utm_content', 120), ''),
    nullif(left(p->>'utm_term', 120), ''), nullif(left(p->>'ip_hash', 100), '')
  )
  returning * into v_row;

  select count(*) into v_count from public.ospod_waitlist_signups;
  return jsonb_build_object(
    'already', false, 'member_no', v_row.member_no, 'id', v_row.id,
    'founding', v_row.member_no <= p_cap, 'claimed', least(v_count, p_cap));
end;
$fn$;

-- The count the page's meter shows (never above the cap).
create or replace function public.ospod_waitlist_claimed(p_cap integer default 500)
returns integer
language sql
security definer
set search_path = public
stable
as $fn$
  select least(count(*)::integer, p_cap) from public.ospod_waitlist_signups;
$fn$;

revoke all on function public.ospod_waitlist_join(jsonb, integer) from public, anon, authenticated;
revoke all on function public.ospod_waitlist_claimed(integer) from public, anon, authenticated;
grant execute on function public.ospod_waitlist_join(jsonb, integer) to service_role;
grant execute on function public.ospod_waitlist_claimed(integer) to service_role;


-- 4. Permissions: the 'ospod_waitlist' module (admin only until you switch it on for a role) ----------

insert into public.role_permissions (role, module, allowed)
values ('sales', 'ospod_waitlist', false), ('marketing', 'ospod_waitlist', false)
on conflict (role, module) do nothing;


-- Review: the table should show only the policies above.
select tablename, policyname, cmd
from pg_policies
where tablename = 'ospod_waitlist_signups'
order by cmd, policyname;
