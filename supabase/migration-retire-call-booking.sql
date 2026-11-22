-- ============================================================
-- Retire online call booking (safe to re-run)
--
-- Visitors no longer book calls on sdfmgroup.com: /book redirects to /contact, and the
-- Automation scoper ends with "leave your details and we'll contact you". This stops the two
-- jobs that only existed for booked calls:
--
--   send-booking-nudges   emailed people who saved details on /book but never picked a time
--   send-call-reminders   reminded leads and the team ahead of a booked discovery call
--
-- Nothing is deleted: the functions, tables and past bookings stay as they are. To bring a job
-- back, run its original file again (migration-booking-nudges-cron.sql, migration-call-reminders.sql).
-- ============================================================

do $$
begin
  if exists (select 1 from cron.job where jobname = 'send-booking-nudges') then
    perform cron.unschedule('send-booking-nudges');
  end if;
  if exists (select 1 from cron.job where jobname = 'send-call-reminders') then
    perform cron.unschedule('send-call-reminders');
  end if;
end $$;
