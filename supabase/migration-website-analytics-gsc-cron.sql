-- ============================================================
-- Website Analytics — pg_cron schedule for the Search Console sync (safe to re-run)
--
--   wa-gsc-sync   daily at 02:30 UTC (05:30 Nairobi)   calls the sm-gsc-sync Edge Function
--       Pulls clicks, impressions, CTR and position into seo_daily, seo_queries and
--       seo_dimension_daily. Search Console data lags 2–3 days and Google keeps revising
--       the most recent days, so every run re-syncs a rolling 10-day window (body
--       {"days": 10}) ending two days ago; rows are upserted, so nothing is duplicated.
--       The function treats an anon-key call as the cron job: at most once per 6 hours,
--       at most 30 days per call.
--
-- Before running: replace YOUR_PROJECT_URL and YOUR_ANON_KEY below (same values as the other cron files;
-- do not commit the real values), and deploy the function:
--   supabase functions deploy sm-gsc-sync --no-verify-jwt --use-api
--
-- Run after migration-website-analytics.sql. Replaces the wa-gsc-sync job that
-- migration-website-analytics-cron.sql used to define.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'wa-gsc-sync') then
    perform cron.unschedule('wa-gsc-sync');
  end if;
end $$;

select cron.schedule(
  'wa-gsc-sync',
  '30 2 * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_URL.supabase.co/functions/v1/sm-gsc-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'YOUR_ANON_KEY',
      'Authorization', 'Bearer YOUR_ANON_KEY'
    ),
    body := '{"days": 10}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
