-- ============================================================
-- Client-facing "lead lost" template. The team-facing 'lead_lost' and
-- 'stage_changed' templates, plus the client-facing 'questions_sent',
-- 'report_ready', and 'contract_sent' templates, already exist from
-- migration-email-templates.sql and are now wired up by the
-- notify-lead-stage Edge Function — no schema change needed for those.
-- Run in Supabase SQL Editor
-- ============================================================

insert into public.email_templates
  (template_key, name, recipient_type, description, subject, body_html, is_active, available_variables)
values
('lead_lost_client', 'Lead Lost (Client)', 'client',
 'Sent to the lead themselves when they are marked as lost from the pipeline.',
 'Following Up — SDFM Group Limited',
 '<p>TODO: write this email, then activate it.</p>',
 false,
 ARRAY['full_name','company_name','email','classification','current_stage','lost_reason'])

on conflict (template_key) do nothing;
