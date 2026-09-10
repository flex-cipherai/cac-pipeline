-- ============================================================
-- Fix: RLS policies for system_settings and calendar_availability
-- Run in Supabase SQL Editor
-- ============================================================

-- Allow anonymous users to read system_settings (public intake form reads booking config)
drop policy if exists "Authenticated users can view settings" on public.system_settings;
create policy "Anyone can view settings"
  on public.system_settings for select
  to anon, authenticated
  using (true);

-- Allow sales managers to manage calendar availability (not just admins)
drop policy if exists "Admins can manage calendar availability" on public.calendar_availability;
create policy "Admin and sales can manage calendar availability"
  on public.calendar_availability for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'sales')
    )
  );

-- Allow sales managers to manage system_settings (booking config)
drop policy if exists "Admins can manage settings" on public.system_settings;
create policy "Admin and sales can manage settings"
  on public.system_settings for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'sales')
    )
  );
