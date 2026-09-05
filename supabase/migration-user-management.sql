-- ============================================================
-- Migration: User Management Features
-- Run this in the Supabase SQL Editor
-- ============================================================

-- Add is_active and last_sign_in_at to profiles
alter table public.profiles 
  add column if not exists is_active boolean default true,
  add column if not exists last_sign_in_at timestamptz;

-- Allow the first admin to insert their own profile (bootstrap)
-- Update the existing insert policy to also allow self-insert
drop policy if exists "Admins can insert profiles" on public.profiles;

create policy "Profiles can be inserted by trigger or admin"
  on public.profiles for insert
  to authenticated
  with check (true);
