-- ============================================================
-- Social Media Management — scheduled jobs (pg_cron + pg_net)
--
-- 1. sm-move-to-ready: every 5 minutes, flips due `posts` from
--    'scheduled' to 'ready_to_post'. This is the Assisted-Mode publishing
--    engine (spec §4.1/§6.5) — the actual "post to LinkedIn" step stays a
--    manual copy/paste + Mark as Posted action in the UI.
-- 2. sm-weekly-digest: every Monday 08:00 UTC, emails the performance
--    digest for the past 7 days.
--
-- Replace YOUR_PROJECT_URL and YOUR_ANON_KEY below before running (same
-- values as migration-call-reminders.sql — the anon key is the public one
-- from .env, not a secret).
-- Run this in the Supabase SQL Editor, after deploying both functions.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'sm-move-to-ready') then
    perform cron.unschedule('sm-move-to-ready');
  end if;
  if exists (select 1 from cron.job where jobname = 'sm-weekly-digest') then
    perform cron.unschedule('sm-weekly-digest');
  end if;
end $$;

select cron.schedule(
  'sm-move-to-ready',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_URL.supabase.co/functions/v1/sm-move-to-ready',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'YOUR_ANON_KEY',
      'Authorization', 'Bearer YOUR_ANON_KEY'
    ),
    body := '{}'::jsonb
  );
  $$
);

select cron.schedule(
  'sm-weekly-digest',
  '0 8 * * 1',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_URL.supabase.co/functions/v1/sm-weekly-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'YOUR_ANON_KEY',
      'Authorization', 'Bearer YOUR_ANON_KEY'
    ),
    body := '{}'::jsonb
  );
  $$
);
