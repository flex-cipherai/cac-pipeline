-- ============================================================
-- Timezone support: team operating timezone, per-user display
-- timezone, and the timezone a lead booked in.
-- Run in Supabase SQL Editor
-- ============================================================

-- The timezone calendar_availability day/time slots are defined in — the
-- "reference frame" every scheduled_date/scheduled_time is stored against.
insert into public.system_settings (key, value)
values ('team_timezone', 'Africa/Nairobi')
on conflict (key) do nothing;

-- Each team member's own display timezone (defaults to null = falls back to
-- team_timezone everywhere it's read).
alter table public.profiles add column if not exists timezone text;

-- The timezone the lead selected on the intake form, used to show them their
-- own call time correctly in confirmation screens/emails.
alter table public.leads add column if not exists timezone text;
