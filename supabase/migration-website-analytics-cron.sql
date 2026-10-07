-- ============================================================
-- Website Analytics — scheduled jobs (pg_cron + pg_net)
--
-- 1. sm-gsc-sync:  daily 04:00 UTC, pulls Google Search Console data.
--                  Skips itself harmlessly until the service account and
--                  property are configured (see README → Website Analytics).
-- 2. purge:        Sundays 03:00 UTC, deletes raw web sessions/events older
--                  than 760 days (~25 months) to keep the tables small.
--
-- Replace YOUR_PROJECT_URL and YOUR_ANON_KEY below before running (same
-- values as migration-social-scheduler-cron.sql — the anon key is the public
-- one from .env, not a secret). The sync function throttles anon-key calls
-- to once per 6 hours, so exposure of that key cannot hammer the Google API.
--
-- Run in the Supabase SQL Editor, after migration-website-analytics.sql and
-- after deploying sm-gsc-sync.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'wa-gsc-sync') then
    perform cron.unschedule('wa-gsc-sync');
  end if;
  if exists (select 1 from cron.job where jobname = 'wa-purge-old-data') then
    perform cron.unschedule('wa-purge-old-data');
  end if;
end $$;

select cron.schedule(
  'wa-gsc-sync',
  '0 4 * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_URL.supabase.co/functions/v1/sm-gsc-sync',
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
  'wa-purge-old-data',
  '0 3 * * 0',
  $$ select public.wa_purge_old_web_data(760); $$
);
