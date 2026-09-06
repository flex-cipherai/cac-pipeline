-- ============================================================
-- Allow Sales role to manage calendar availability
-- Run this in the Supabase SQL Editor
-- ============================================================

-- Drop the admin-only policy
drop policy if exists "Admins can manage calendar availability" on public.calendar_availability;

-- Create new policy that allows admin AND sales
create policy "Admin and sales can manage calendar availability"
  on public.calendar_availability for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'sales')
    )
  );
