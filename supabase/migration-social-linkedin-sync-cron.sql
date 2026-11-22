-- ============================================================
-- Social Media Management — LinkedIn sync job (pg_cron + pg_net)
--
-- Every hour at :20, sm-linkedin-sync pulls post analytics, the Company
-- Page follower count and new Company Page comments for every LinkedIn
-- account in Automated Mode. (Publishing itself runs in sm-move-to-ready,
-- already scheduled every 5 minutes by migration-social-scheduler-cron.sql.)
--
-- Replace YOUR_PROJECT_URL and YOUR_ANON_KEY before running (same values as
-- migration-social-scheduler-cron.sql — the anon key is the public one).
-- Run in the Supabase SQL Editor after deploying sm-linkedin-sync.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'sm-linkedin-sync') then
    perform cron.unschedule('sm-linkedin-sync');
  end if;
end $$;

select cron.schedule(
  'sm-linkedin-sync',
  '20 * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_URL.supabase.co/functions/v1/sm-linkedin-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'YOUR_ANON_KEY',
      'Authorization', 'Bearer YOUR_ANON_KEY'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
