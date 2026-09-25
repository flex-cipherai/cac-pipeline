-- ============================================================
-- Follow-up date reminders: notify admin/sales the day before,
-- and on the day of, a lead's follow-up date (email + in-app bell).
-- Run in Supabase SQL Editor
-- ============================================================

-- Anti-double-send guards: store which follow_up_date each reminder was
-- last sent for. Changing (or clearing) the follow-up date naturally
-- resets both, since the stored value stops matching.
alter table public.leads add column if not exists follow_up_reminder_before_sent_for date;
alter table public.leads add column if not exists follow_up_reminder_due_sent_for date;

-- Placeholder templates (is_active = false until copy is written on the
-- Notifications page and activated there) — same convention as
-- discovery_call_reminder_client/_team in migration-call-reminders.sql.
insert into public.email_templates
  (template_key, name, recipient_type, description, subject, body_html, is_active, available_variables)
values
('follow_up_reminder_before', 'Follow-up Reminder (Day Before)', 'team',
 'Sent to admin/sales the day before a lead''s follow-up date.',
 'Follow-up Tomorrow: {{full_name}} ({{company_name}})',
 '<p>TODO: write this reminder email on the Notifications page, then activate it.</p>',
 false,
 ARRAY['full_name','company_name','email','phone','classification','current_stage','follow_up_date']),

('follow_up_reminder_due', 'Follow-up Reminder (Due Today)', 'team',
 'Sent to admin/sales on the day of a lead''s follow-up date.',
 'Follow-up Due Today: {{full_name}} ({{company_name}})',
 '<p>TODO: write this reminder email on the Notifications page, then activate it.</p>',
 false,
 ARRAY['full_name','company_name','email','phone','classification','current_stage','follow_up_date'])

on conflict (template_key) do nothing;

-- Schedule: once daily at 06:00 UTC (~09:00 Africa/Nairobi). Adjust the
-- hour below if the team's working timezone differs meaningfully.
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'send-follow-up-reminders') then
    perform cron.unschedule('send-follow-up-reminders');
  end if;
end $$;

-- Replace YOUR_PROJECT_URL and YOUR_ANON_KEY below before running.
select cron.schedule(
  'send-follow-up-reminders',
  '0 6 * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_URL.supabase.co/functions/v1/send-follow-up-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'YOUR_ANON_KEY',
      'Authorization', 'Bearer YOUR_ANON_KEY'
    ),
    body := '{}'::jsonb
  );
  $$
);
