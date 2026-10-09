-- ============================================================
-- Schedule the "finish booking your call" email.
-- Run after the send-booking-nudges Edge Function is deployed.
-- Replace YOUR_PROJECT_URL and YOUR_ANON_KEY below before running (the anon
-- key is the public one from .env — it only satisfies the function's JWT
-- check, exactly as in migration-call-reminders.sql). Safe to re-run.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'send-booking-nudges') then
    perform cron.unschedule('send-booking-nudges');
  end if;
end $$;

-- Every 15 minutes. The function only emails leads that have been "Incomplete"
-- for 30 minutes to 48 hours and have not been nudged yet, so running often
-- never sends a lead more than one email.
select cron.schedule(
  'send-booking-nudges',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_URL.supabase.co/functions/v1/send-booking-nudges',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'YOUR_ANON_KEY',
      'Authorization', 'Bearer YOUR_ANON_KEY'
    ),
    body := '{}'::jsonb
  );
  $$
);
