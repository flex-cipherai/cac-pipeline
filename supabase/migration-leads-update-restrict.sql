-- ============================================================
-- Restore "only admin and sales can update leads" (schema.sql).
--
-- The live project had that policy replaced by a hand-made one,
-- auth_update_leads, whose condition is simply `true`, so any signed-in user
-- (including the marketing role) could edit or re-stage any lead through the
-- API, even though no marketing screen offers it.
--
-- Staff screens that edit leads (Pipeline, All Leads, lead detail) are
-- admin/sales routes already, and the booking Edge Functions use the service
-- role, which bypasses RLS, so nothing legitimate loses access.
--
-- Run in the Supabase SQL Editor. Safe to re-run.
-- ============================================================

drop policy if exists "auth_update_leads" on public.leads;
drop policy if exists "Admin and sales can update leads" on public.leads;

create policy "Admin and sales can update leads"
  on public.leads for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'sales')
    )
  );

-- Review: leads should show exactly one UPDATE policy, "Admin and sales can update leads".
select policyname, roles, cmd
from pg_policies
where tablename = 'leads'
order by cmd, policyname;
