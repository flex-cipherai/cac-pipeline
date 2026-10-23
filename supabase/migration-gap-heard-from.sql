-- ============================================================
-- Automation scoper: "How did you hear about us?" (safe to re-run)
--
-- The optional question on the details form of sdfmgroup.com/ai-gap-check. heard_from is one of
-- linkedin | instagram | other; heard_from_other holds the visitor's own words when they chose Other.
-- Shown in the CRM under Automation Scoper (list, detail, CSV export).
--
-- Run in the Supabase SQL Editor before (or with) deploying the gap-assessment function and the CRM.
-- ============================================================

alter table public.gap_assessments add column if not exists heard_from text;
alter table public.gap_assessments add column if not exists heard_from_other text;

alter table public.gap_assessments drop constraint if exists gap_assessments_heard_from_check;
alter table public.gap_assessments
  add constraint gap_assessments_heard_from_check
  check (heard_from is null or heard_from in ('linkedin', 'instagram', 'other'));
