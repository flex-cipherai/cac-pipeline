-- ============================================================
-- Booking flow v2 — LOCK DOWN public database access. Run this LAST.
--
-- Before this, the public /intake form wrote straight to the database as the
-- anonymous role, so anyone holding the (public) anon key could:
--   * insert leads with any classification / stage / score they liked,
--   * read every booked slot, and
--   * read ALL of system_settings.
-- The booking page on sdfmgroup.com now goes through the booking-* Edge
-- Functions instead (service role), so none of that access is needed.
--
-- ONLY run this once:
--   1. migration-booking-flow.sql has been applied,
--   2. the booking-* Edge Functions are deployed,
--   3. sdfmgroup.com/book is live and a test booking has worked, and
--   4. this app's /intake route redirects to sdfmgroup.com/book.
-- Anything still using the old /intake form (e.g. a cached tab) will fail.
--
-- Staff (authenticated users) keep exactly the access they had. Safe to re-run.
-- ============================================================

-- leads: no more anonymous inserts. Staff can still add leads manually.
drop policy if exists "Anyone can submit a lead" on public.leads;
-- Not defined in any migration: created by hand in the dashboard on the live
-- project, and it lets the anon key insert leads. Dropped explicitly.
drop policy if exists "anon_insert_leads" on public.leads;
drop policy if exists "Authenticated users can add leads" on public.leads;
create policy "Authenticated users can add leads"
  on public.leads for insert
  to authenticated
  with check (true);

-- booked_slots: no anonymous reads or writes.
drop policy if exists "Anyone can view booked slots" on public.booked_slots;
drop policy if exists "Anyone can insert booked slots" on public.booked_slots;
drop policy if exists "Authenticated users can view booked slots" on public.booked_slots;
create policy "Authenticated users can view booked slots"
  on public.booked_slots for select
  to authenticated
  using (true);
drop policy if exists "Authenticated users can insert booked slots" on public.booked_slots;
create policy "Authenticated users can insert booked slots"
  on public.booked_slots for insert
  to authenticated
  with check (true);

-- lead_stage_history: no anonymous inserts.
drop policy if exists "Stage history can be inserted by system or auth users" on public.lead_stage_history;
drop policy if exists "Authenticated users can insert stage history" on public.lead_stage_history;
create policy "Authenticated users can insert stage history"
  on public.lead_stage_history for insert
  to authenticated
  with check (true);

-- calendar_availability: staff only (the page gets slots from booking-info).
drop policy if exists "Anyone can view calendar availability" on public.calendar_availability;
drop policy if exists "Authenticated users can view calendar availability" on public.calendar_availability;
create policy "Authenticated users can view calendar availability"
  on public.calendar_availability for select
  to authenticated
  using (true);

-- system_settings: staff only. (Previously readable by anyone with the anon key.)
drop policy if exists "Anyone can view settings" on public.system_settings;
drop policy if exists "Authenticated users can view settings" on public.system_settings;
create policy "Authenticated users can view settings"
  on public.system_settings for select
  to authenticated
  using (true);

-- Review: nothing below should list anon for these tables.
select tablename, policyname, roles, cmd
from pg_policies
where tablename in ('leads', 'booked_slots', 'lead_stage_history', 'calendar_availability', 'system_settings')
order by tablename, policyname;
