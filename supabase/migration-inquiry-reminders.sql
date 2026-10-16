-- ============================================================
-- Inquiry reminders — columns and email templates (safe to re-run)
--
-- Backs the send-inquiry-reminders Edge Function, which tells the team about inquiries that need them:
--   daily digest   follow-ups due today or tomorrow, and inquiries that have gone quiet
--   reply alerts   new inquiries nobody has answered for 24 hours (working hours only)
--
-- Each person gets ONE email per run listing their inquiries (the owner's, or everyone's when an
-- inquiry has no owner), plus an entry in the in-app notification bell.
--
-- The *_sent_* columns make every reminder go out once: change a follow-up date, or contact someone
-- again, and the matching reminder arms itself again.
--
-- Run after migration-inquiries.sql. Then deploy the function and run migration-inquiry-reminders-cron.sql.
-- ============================================================

alter table public.inquiries add column if not exists reminder_before_sent_for date;
alter table public.inquiries add column if not exists reminder_due_sent_for date;
alter table public.inquiries add column if not exists quiet_alert_sent_for timestamptz;
alter table public.inquiries add column if not exists reply_alert_sent_at timestamptz;


-- Templates (team-facing). Edit the wording on the Notifications page; switch one off there to stop
-- that email (the in-app notification still goes out).
--   {{items_html}} is the list of inquiries, already formatted and grouped by the function.
insert into public.email_templates
  (template_key, name, recipient_type, description, subject, body_html, is_active, available_variables)
values
('inquiry_reminder_daily', 'Inquiry Follow-ups (daily digest)', 'team',
 'Sent each morning to the owner of an inquiry (or to everyone when it has no owner): follow-ups due today or tomorrow, and inquiries that have gone quiet. Only sent when there is something to say.',
 '{{total_count}} inquiries need follow-up',
 '<div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #201E1D;">
  <div style="padding: 32px 0 24px; text-align: center;">
    <span style="font-size: 22px; font-weight: 700; color: #EC3013;">SDFM GROUP</span>
    <span style="font-size: 12px; display: block; letter-spacing: 0.15em; color: #201E1D;">LIMITED</span>
  </div>
  <div style="background: #F3F2F2; border-radius: 10px; padding: 32px; margin-bottom: 24px;">
    <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 8px;">Inquiries to follow up</h1>
    <p style="font-size: 14px; color: #666; margin: 0 0 8px; line-height: 1.6;">Good morning {{recipient_name}}. {{total_count}} inquiries need you today.</p>
    <div style="background: white; border-radius: 8px; padding: 4px 20px 16px; border-left: 4px solid #EC3013;">
      {{items_html}}
    </div>
    <p style="margin: 24px 0 0;"><a href="{{app_link}}" style="display: inline-block; background: #D82A10; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 700; padding: 12px 24px; border-radius: 6px;">Open Inquiries</a></p>
  </div>
  <p style="font-size: 12px; color: #999; text-align: center;">SDFM Group Limited · Internal reminder</p>
</div>',
 true,
 ARRAY['recipient_name','total_count','follow_up_due_count','follow_up_tomorrow_count','gone_quiet_count','items_html','app_link']),

('inquiry_reply_overdue', 'Inquiry Waiting for a Reply', 'team',
 'Sent in working hours when a new inquiry has had no reply for 24 hours. Once per inquiry, to its owner (or to everyone when it has no owner).',
 '{{total_count}} inquiries are waiting for a first reply',
 '<div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #201E1D;">
  <div style="padding: 32px 0 24px; text-align: center;">
    <span style="font-size: 22px; font-weight: 700; color: #EC3013;">SDFM GROUP</span>
    <span style="font-size: 12px; display: block; letter-spacing: 0.15em; color: #201E1D;">LIMITED</span>
  </div>
  <div style="background: #F3F2F2; border-radius: 10px; padding: 32px; margin-bottom: 24px;">
    <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 8px;">Someone is waiting to hear from us</h1>
    <p style="font-size: 14px; color: #666; margin: 0 0 8px; line-height: 1.6;">Hi {{recipient_name}}, these inquiries have had no reply for more than {{reply_target_hours}} hours. A quick message now keeps the conversation alive.</p>
    <div style="background: white; border-radius: 8px; padding: 4px 20px 16px; border-left: 4px solid #EC3013;">
      {{items_html}}
    </div>
    <p style="margin: 24px 0 0;"><a href="{{app_link}}" style="display: inline-block; background: #D82A10; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 700; padding: 12px 24px; border-radius: 6px;">Open Inquiries</a></p>
  </div>
  <p style="font-size: 12px; color: #999; text-align: center;">SDFM Group Limited · Internal reminder</p>
</div>',
 true,
 ARRAY['recipient_name','total_count','reply_target_hours','items_html','app_link'])
on conflict (template_key) do nothing;
