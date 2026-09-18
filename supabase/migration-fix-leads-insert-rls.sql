-- ============================================================
-- Fix: public lead intake form (anon) blocked by RLS on leads insert
-- Run in Supabase SQL Editor
-- ============================================================

-- Recreate the anon/authenticated insert policy on leads idempotently.
-- (schema.sql defines this, but it's missing/inactive on the live project.)
drop policy if exists "Anyone can submit a lead" on public.leads;
create policy "Anyone can submit a lead"
  on public.leads for insert
  to anon, authenticated
  with check (true);

-- The intake form also inserts into booked_slots and lead_stage_history
-- right after the lead is created — make sure those are in place too.
drop policy if exists "Anyone can insert booked slots" on public.booked_slots;
create policy "Anyone can insert booked slots"
  on public.booked_slots for insert
  to anon, authenticated
  with check (true);

drop policy if exists "Stage history can be inserted by system or auth users" on public.lead_stage_history;
create policy "Stage history can be inserted by system or auth users"
  on public.lead_stage_history for insert
  to anon, authenticated
  with check (true);

-- Sanity check: list current insert policies on these tables
select tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where tablename in ('leads', 'booked_slots', 'lead_stage_history')
order by tablename, policyname;
