-- ============================================================
-- Inquiry reminders — pg_cron schedules (safe to re-run)
--
-- Two jobs call the same Edge Function in different modes:
--   send-inquiry-reminders     06:00 UTC daily (09:00 Africa/Nairobi)  {"mode":"daily"}
--       follow-ups due today or tomorrow, and inquiries that have gone quiet
--   send-inquiry-reply-alerts  every hour, on the hour                 {"mode":"replies"}
--       new inquiries unanswered for 24 hours. The function only sends them between 08:00 and 18:00
--       team time, so a late-night overdue inquiry is held until the next working hour.
--
-- Before running: replace YOUR_PROJECT_URL and YOUR_ANON_KEY below (same values as
-- migration-follow-up-reminders.sql), and deploy the function:
--   supabase functions deploy send-inquiry-reminders --no-verify-jwt
-- It needs the same secrets as the other reminder functions (RESEND_API_KEY, SENDER_EMAIL).
--
-- Run after migration-inquiry-reminders.sql.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'send-inquiry-reminders') then
    perform cron.unschedule('send-inquiry-reminders');
  end if;
  if exists (select 1 from cron.job where jobname = 'send-inquiry-reply-alerts') then
    perform cron.unschedule('send-inquiry-reply-alerts');
  end if;
end $$;

select cron.schedule(
  'send-inquiry-reminders',
  '0 6 * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_URL.supabase.co/functions/v1/send-inquiry-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'YOUR_ANON_KEY',
      'Authorization', 'Bearer YOUR_ANON_KEY'
    ),
    body := '{"mode":"daily"}'::jsonb
  );
  $$
);

select cron.schedule(
  'send-inquiry-reply-alerts',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_URL.supabase.co/functions/v1/send-inquiry-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'YOUR_ANON_KEY',
      'Authorization', 'Bearer YOUR_ANON_KEY'
    ),
    body := '{"mode":"replies"}'::jsonb
  );
  $$
);

-- Review
select jobname, schedule from cron.job where jobname like 'send-inquiry-%' order by jobname;
