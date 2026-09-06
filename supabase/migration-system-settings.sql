-- ============================================================
-- System Settings table for key-value configuration
-- Used by Google Calendar integration and other system-wide settings
-- Run this in the Supabase SQL Editor
-- ============================================================

create table if not exists public.system_settings (
  key text primary key,
  value text,
  updated_at timestamptz default now()
);

alter table public.system_settings enable row level security;

-- Only authenticated users can read
create policy "Authenticated users can view settings"
  on public.system_settings for select
  to authenticated
  using (true);

-- Only admins can modify
create policy "Admins can manage settings"
  on public.system_settings for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

-- Service role (Edge Functions) bypass RLS automatically
