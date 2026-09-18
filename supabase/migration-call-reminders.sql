-- ============================================================
-- Discovery call reminder emails: settings, tracking column,
-- placeholder templates, and the cron schedule that checks for
-- calls due for a reminder.
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. How many hours before a call reminders go out (editable in Settings).
insert into public.system_settings (key, value)
values ('reminder_hours_before_call', '24')
on conflict (key) do nothing;

-- 2. Tracks whether a reminder has already gone out for a lead's current
--    booking, so the cron check never double-sends.
alter table public.leads add column if not exists reminder_sent_at timestamptz;

-- 3. Reminder templates — bodies are placeholders. Write the real copy on
--    the Notifications page, then flip each one Active; nothing sends
--    while a template is inactive.
insert into public.email_templates
  (template_key, name, recipient_type, description, subject, body_html, is_active, available_variables)
values
('discovery_call_reminder_client', 'Discovery Call Reminder (Client)', 'client',
 'Sent to the lead ahead of their scheduled discovery call. Timing is set by the "Reminder timing" booking setting.',
 'Reminder: Your Discovery Call is Coming Up',
 '<p>TODO: write this reminder email on the Notifications page, then activate it.</p>',
 false,
 ARRAY['full_name','company_name','email','phone','scheduled_day','scheduled_time','classification']),

('discovery_call_reminder_team', 'Discovery Call Reminder (Team)', 'team',
 'Sent to admin/sales ahead of a lead''s scheduled discovery call. Timing is set by the "Reminder timing" booking setting.',
 'Reminder: Upcoming Discovery Call with {{full_name}}',
 '<p>TODO: write this reminder email on the Notifications page, then activate it.</p>',
 false,
 ARRAY['full_name','company_name','email','phone','scheduled_day','scheduled_time','classification','total_score'])

on conflict (template_key) do nothing;

-- 4. Schedule the reminder check every 15 minutes via pg_cron + pg_net.
--    Replace YOUR_PROJECT_URL and YOUR_ANON_KEY below before running.
--    (The anon key is the public one from your .env / frontend — not a
--    secret — it just satisfies the Edge Function's default JWT check.)
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'send-call-reminders') then
    perform cron.unschedule('send-call-reminders');
  end if;
end $$;

select cron.schedule(
  'send-call-reminders',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_URL.supabase.co/functions/v1/send-call-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'YOUR_ANON_KEY',
      'Authorization', 'Bearer YOUR_ANON_KEY'
    ),
    body := '{}'::jsonb
  );
  $$
);
