-- ============================================================
-- Sales pipeline — pg_cron schedule for the 48-hour alert (safe to re-run)
--
--   send-pipeline-alerts   every hour, at :15   calls the send-pipeline-alerts Edge Function
--       Active leads with no logged interaction for 48 hours: flagged to the admins by email and in the
--       notification bell, once per quiet spell. Only sent 08:00–18:00 team time.
--
-- Before running: replace YOUR_PROJECT_URL and YOUR_ANON_KEY below (same values as the other cron files;
-- do not commit the real values), and deploy the function:
--   supabase functions deploy send-pipeline-alerts --no-verify-jwt
--
-- Run after migration-sales-pipeline.sql.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'send-pipeline-alerts') then
    perform cron.unschedule('send-pipeline-alerts');
  end if;
end $$;

select cron.schedule(
  'send-pipeline-alerts',
  '15 * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_URL.supabase.co/functions/v1/send-pipeline-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'YOUR_ANON_KEY',
      'Authorization', 'Bearer YOUR_ANON_KEY'
    ),
    body := '{}'::jsonb
  );
  $$
);
