-- ============================================================
-- Add profile fields: phone, job_title
-- Run in Supabase SQL Editor
-- ============================================================

-- Add new columns to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone text DEFAULT '';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS job_title text DEFAULT '';

-- Allow users to update their own profile (name, phone, job_title)
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());
