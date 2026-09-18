-- ============================================================
-- ONE-TIME: clear test/demo data before going live.
-- Deletes ALL leads (and everything tied to them — booked_slots,
-- lead_stage_history, lead_notes cascade via ON DELETE CASCADE) and
-- clears calendar_availability so you reconfigure real booking hours
-- from Settings. This does NOT touch user accounts, email_templates,
-- or system_settings — those stay as configured.
--
-- This is irreversible. Run the SELECT first to see what you're about
-- to delete; only run the DELETE statements once you're sure.
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Review what will be deleted before running anything below.
select
  (select count(*) from public.leads) as leads_count,
  (select count(*) from public.booked_slots) as booked_slots_count,
  (select count(*) from public.lead_stage_history) as stage_history_count,
  (select count(*) from public.lead_notes) as notes_count,
  (select count(*) from public.calendar_availability where is_available) as active_availability_slots;

-- 2. Delete all leads — cascades to booked_slots, lead_stage_history, lead_notes.
delete from public.leads;

-- 3. Clear calendar availability so it's reconfigured fresh in Settings.
delete from public.calendar_availability;
