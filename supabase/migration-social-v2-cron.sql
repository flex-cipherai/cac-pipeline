-- ============================================================
-- Social Media Management v2 — scheduled jobs (pg_cron + pg_net)
--
--   sm-sync       hourly at :20  analytics, followers, comments (all platforms)
--                                 — replaces sm-linkedin-sync
--   sm-autolists  hourly at :40  keeps evergreen autolists filled 7 days ahead
--   sm-reports    daily 04:00 UTC (07:00 Nairobi) — scheduled email reports
--                                 — replaces sm-weekly-digest
-- (sm-move-to-ready, every 5 minutes, is unchanged.)
--
-- Replace YOUR_PROJECT_URL and YOUR_ANON_KEY before running (the anon key is
-- the public one). Run after deploying sm-sync, sm-autolists and sm-reports.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare j text;
begin
  foreach j in array array['sm-linkedin-sync', 'sm-weekly-digest', 'sm-sync', 'sm-autolists', 'sm-reports'] loop
    if exists (select 1 from cron.job where jobname = j) then perform cron.unschedule(j); end if;
  end loop;
end $$;

select cron.schedule('sm-sync', '20 * * * *', $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_URL.supabase.co/functions/v1/sm-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', 'YOUR_ANON_KEY', 'Authorization', 'Bearer YOUR_ANON_KEY'),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
$$);

select cron.schedule('sm-autolists', '40 * * * *', $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_URL.supabase.co/functions/v1/sm-autolists',
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', 'YOUR_ANON_KEY', 'Authorization', 'Bearer YOUR_ANON_KEY'),
    body := '{}'::jsonb, timeout_milliseconds := 60000);
$$);

select cron.schedule('sm-reports', '0 4 * * *', $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_URL.supabase.co/functions/v1/sm-reports',
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', 'YOUR_ANON_KEY', 'Authorization', 'Bearer YOUR_ANON_KEY'),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
$$);
