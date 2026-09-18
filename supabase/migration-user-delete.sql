-- ============================================================
-- Allow deleting a user account without breaking lead history.
-- Deleting a profile cascades from auth.users (schema.sql:8), but
-- lead_stage_history.moved_by and lead_notes.created_by reference
-- profiles with no ON DELETE action, which blocks the delete for any
-- user who ever moved a lead or left a note. Switch both to SET NULL
-- so the history/notes survive, just with an unattributed author.
-- Run in Supabase SQL Editor
-- ============================================================

alter table public.lead_stage_history
  drop constraint if exists lead_stage_history_moved_by_fkey,
  add constraint lead_stage_history_moved_by_fkey
    foreign key (moved_by) references public.profiles(id) on delete set null;

alter table public.lead_notes
  drop constraint if exists lead_notes_created_by_fkey,
  add constraint lead_notes_created_by_fkey
    foreign key (created_by) references public.profiles(id) on delete set null;
