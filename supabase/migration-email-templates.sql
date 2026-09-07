-- ============================================================
-- Email Templates table for notification management
-- Run this in the Supabase SQL Editor
-- ============================================================

create table if not exists public.email_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text unique not null,
  name text not null,
  recipient_type text not null check (recipient_type in ('client', 'team')),
  description text,
  subject text not null,
  body_html text not null,
  is_active boolean default true,
  available_variables text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.email_templates enable row level security;

-- Authenticated users can read templates
create policy "Authenticated users can view templates"
  on public.email_templates for select
  to authenticated
  using (true);

-- Admin and sales can manage templates
create policy "Admin and sales can manage templates"
  on public.email_templates for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'sales')
    )
  );

-- Auto-update updated_at
create trigger on_email_templates_updated
  before update on public.email_templates
  for each row execute function public.handle_updated_at();

-- ── Seed default templates ──

insert into public.email_templates (template_key, name, recipient_type, description, subject, body_html, available_variables) values

-- Client: Call Confirmed
('call_confirmed', 'Discovery Call Confirmed', 'client',
 'Sent to qualified leads (Hot and Warm) when they book a discovery call.',
 'Your Discovery Call is Confirmed — {{scheduled_day}} at {{scheduled_time}}',
 '<div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #201E1D;">
  <div style="padding: 32px 0 24px; text-align: center;">
    <span style="font-size: 22px; font-weight: 700; color: #EC3013;">CIPHER AI</span>
    <span style="font-size: 12px; display: block; letter-spacing: 0.15em; color: #201E1D;">CONSULTANTS</span>
  </div>
  <div style="background: #F3F2F2; border-radius: 10px; padding: 32px; margin-bottom: 24px;">
    <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 8px;">Discovery Call Confirmed</h1>
    <p style="font-size: 14px; color: #666; margin: 0 0 24px;">Hi {{full_name}}, your call has been scheduled.</p>
    <div style="background: white; border-radius: 8px; padding: 20px; border-left: 4px solid #EC3013;">
      <p style="margin: 0; font-size: 14px;"><strong>Date:</strong> {{scheduled_day}}</p>
      <p style="margin: 8px 0 0; font-size: 14px;"><strong>Time:</strong> {{scheduled_time}}</p>
    </div>
    <p style="font-size: 14px; color: #666; margin: 24px 0 0; line-height: 1.6;">During this call, we will discuss your business challenges and explore how AI solutions can help. No preparation is needed — just bring your questions.</p>
  </div>
  <p style="font-size: 12px; color: #999; text-align: center;">Cipher AI Consultants · Transforming Kenyan Businesses</p>
</div>',
 ARRAY['full_name','company_name','email','phone','scheduled_day','scheduled_time','classification','total_score']),

-- Client: Cold Rejection
('cold_rejection', 'Thank You (Disqualified)', 'client',
 'Sent to Cold leads after form submission. Polite and invites future reconnection.',
 'Thank You for Your Interest — Cipher AI Consultants',
 '<div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #201E1D;">
  <div style="padding: 32px 0 24px; text-align: center;">
    <span style="font-size: 22px; font-weight: 700; color: #EC3013;">CIPHER AI</span>
    <span style="font-size: 12px; display: block; letter-spacing: 0.15em; color: #201E1D;">CONSULTANTS</span>
  </div>
  <div style="background: #F3F2F2; border-radius: 10px; padding: 32px; margin-bottom: 24px;">
    <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 16px;">Thank You, {{full_name}}</h1>
    <p style="font-size: 14px; color: #666; line-height: 1.6; margin: 0 0 16px;">We appreciate you taking the time to tell us about your business.</p>
    <p style="font-size: 14px; color: #666; line-height: 1.6; margin: 0;">Based on the information you provided, our services may not be the right fit at this time. As your needs evolve, we would welcome the chance to reconnect. You can book a discovery call anytime from our website.</p>
  </div>
  <p style="font-size: 12px; color: #999; text-align: center;">Cipher AI Consultants · Transforming Kenyan Businesses</p>
</div>',
 ARRAY['full_name','company_name','email']),

-- Client: Questions Sent
('questions_sent', 'Assessment Questions Sent', 'client',
 'Sent when assessment questions are delivered to the lead.',
 'Your AI Gap Assessment Questions — Cipher AI Consultants',
 '<div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #201E1D;">
  <div style="padding: 32px 0 24px; text-align: center;">
    <span style="font-size: 22px; font-weight: 700; color: #EC3013;">CIPHER AI</span>
    <span style="font-size: 12px; display: block; letter-spacing: 0.15em; color: #201E1D;">CONSULTANTS</span>
  </div>
  <div style="background: #F3F2F2; border-radius: 10px; padding: 32px; margin-bottom: 24px;">
    <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 8px;">Assessment Questions Ready</h1>
    <p style="font-size: 14px; color: #666; line-height: 1.6; margin: 0 0 16px;">Hi {{full_name}}, following our discovery call, we have prepared a set of detailed questions to help us understand your business operations more deeply.</p>
    <p style="font-size: 14px; color: #666; line-height: 1.6; margin: 0;">Please complete and return these at your earliest convenience. Your responses will form the basis of your personalised AI Gap Assessment Report.</p>
  </div>
  <p style="font-size: 12px; color: #999; text-align: center;">Cipher AI Consultants · Transforming Kenyan Businesses</p>
</div>',
 ARRAY['full_name','company_name','email','current_stage']),

-- Client: Report Ready
('report_ready', 'Gap Assessment Report Ready', 'client',
 'Sent when the Gap Assessment Report has been completed and is ready for presentation.',
 'Your AI Gap Assessment Report is Ready — Cipher AI Consultants',
 '<div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #201E1D;">
  <div style="padding: 32px 0 24px; text-align: center;">
    <span style="font-size: 22px; font-weight: 700; color: #EC3013;">CIPHER AI</span>
    <span style="font-size: 12px; display: block; letter-spacing: 0.15em; color: #201E1D;">CONSULTANTS</span>
  </div>
  <div style="background: #F3F2F2; border-radius: 10px; padding: 32px; margin-bottom: 24px;">
    <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 8px;">Your Report is Ready</h1>
    <p style="font-size: 14px; color: #666; line-height: 1.6; margin: 0 0 16px;">Hi {{full_name}}, we have completed your personalised AI Gap Assessment Report for {{company_name}}.</p>
    <p style="font-size: 14px; color: #666; line-height: 1.6; margin: 0;">The report includes a detailed analysis of your current operations, identified opportunities for AI integration, and a recommended implementation roadmap. We will be in touch to schedule a presentation walkthrough.</p>
  </div>
  <p style="font-size: 12px; color: #999; text-align: center;">Cipher AI Consultants · Transforming Kenyan Businesses</p>
</div>',
 ARRAY['full_name','company_name','email','current_stage']),

-- Client: Contract Sent
('contract_sent', 'Contract Sent', 'client',
 'Sent when the project contract is prepared and delivered to the lead.',
 'Your Project Contract — Cipher AI Consultants',
 '<div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #201E1D;">
  <div style="padding: 32px 0 24px; text-align: center;">
    <span style="font-size: 22px; font-weight: 700; color: #EC3013;">CIPHER AI</span>
    <span style="font-size: 12px; display: block; letter-spacing: 0.15em; color: #201E1D;">CONSULTANTS</span>
  </div>
  <div style="background: #F3F2F2; border-radius: 10px; padding: 32px; margin-bottom: 24px;">
    <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 8px;">Your Contract is Ready</h1>
    <p style="font-size: 14px; color: #666; line-height: 1.6; margin: 0 0 16px;">Hi {{full_name}}, we have prepared the project contract for {{company_name}} based on the scope we discussed during the report presentation.</p>
    <p style="font-size: 14px; color: #666; line-height: 1.6; margin: 0;">Please review the attached contract at your convenience. If you have any questions or would like to discuss any terms, do not hesitate to reach out. We are excited to get started.</p>
  </div>
  <p style="font-size: 12px; color: #999; text-align: center;">Cipher AI Consultants · Transforming Kenyan Businesses</p>
</div>',
 ARRAY['full_name','company_name','email','current_stage']),

-- Team: New Lead Alert
('new_lead_alert', 'New Lead Alert', 'team',
 'Sent to the admin/team when a new lead submits the intake form.',
 'New {{classification}} Lead: {{full_name}} from {{company_name}} ({{total_score}}/21)',
 '<div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #201E1D;">
  <div style="padding: 32px 0 24px; text-align: center;">
    <span style="font-size: 22px; font-weight: 700; color: #EC3013;">CIPHER AI</span>
    <span style="font-size: 12px; display: block; letter-spacing: 0.15em; color: #201E1D;">CONSULTANTS</span>
  </div>
  <div style="background: #F3F2F2; border-radius: 10px; padding: 32px; margin-bottom: 24px;">
    <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 16px;">New Lead Submitted</h1>
    <div style="background: white; border-radius: 8px; padding: 20px; margin-bottom: 16px;">
      <p style="margin: 0 0 8px; font-size: 14px;"><strong>Name:</strong> {{full_name}}</p>
      <p style="margin: 0 0 8px; font-size: 14px;"><strong>Company:</strong> {{company_name}}</p>
      <p style="margin: 0 0 8px; font-size: 14px;"><strong>Classification:</strong> {{classification}}</p>
      <p style="margin: 0 0 8px; font-size: 14px;"><strong>Score:</strong> {{total_score}}/21</p>
      <p style="margin: 0; font-size: 14px;"><strong>Call:</strong> {{scheduled_day}} at {{scheduled_time}}</p>
    </div>
    <p style="font-size: 13px; color: #666;">View full details in the Pipeline Dashboard.</p>
  </div>
</div>',
 ARRAY['full_name','company_name','email','phone','classification','total_score','scheduled_day','scheduled_time','source']),

-- Team: Stage Changed
('stage_changed', 'Stage Change Notification', 'team',
 'Sent to the team when a lead moves to a new pipeline stage.',
 'Lead Update: {{full_name}} moved to {{current_stage}}',
 '<div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #201E1D;">
  <div style="padding: 32px 0 24px; text-align: center;">
    <span style="font-size: 22px; font-weight: 700; color: #EC3013;">CIPHER AI</span>
    <span style="font-size: 12px; display: block; letter-spacing: 0.15em; color: #201E1D;">CONSULTANTS</span>
  </div>
  <div style="background: #F3F2F2; border-radius: 10px; padding: 32px; margin-bottom: 24px;">
    <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 16px;">Pipeline Update</h1>
    <div style="background: white; border-radius: 8px; padding: 20px;">
      <p style="margin: 0 0 8px; font-size: 14px;"><strong>Lead:</strong> {{full_name}} ({{company_name}})</p>
      <p style="margin: 0 0 8px; font-size: 14px;"><strong>Previous Stage:</strong> {{previous_stage}}</p>
      <p style="margin: 0; font-size: 14px;"><strong>New Stage:</strong> {{current_stage}}</p>
    </div>
  </div>
</div>',
 ARRAY['full_name','company_name','email','classification','total_score','current_stage','previous_stage']),

-- Team: Lead Lost
('lead_lost', 'Lead Marked as Lost', 'team',
 'Sent to the team when a lead is marked as lost from the pipeline.',
 'Lead Lost: {{full_name}} from {{company_name}}',
 '<div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #201E1D;">
  <div style="padding: 32px 0 24px; text-align: center;">
    <span style="font-size: 22px; font-weight: 700; color: #EC3013;">CIPHER AI</span>
    <span style="font-size: 12px; display: block; letter-spacing: 0.15em; color: #201E1D;">CONSULTANTS</span>
  </div>
  <div style="background: #F3F2F2; border-radius: 10px; padding: 32px; margin-bottom: 24px;">
    <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 16px;">Lead Lost</h1>
    <div style="background: white; border-radius: 8px; padding: 20px;">
      <p style="margin: 0 0 8px; font-size: 14px;"><strong>Lead:</strong> {{full_name}} ({{company_name}})</p>
      <p style="margin: 0 0 8px; font-size: 14px;"><strong>Classification:</strong> {{classification}}</p>
      <p style="margin: 0 0 8px; font-size: 14px;"><strong>Last Stage:</strong> {{current_stage}}</p>
      <p style="margin: 0; font-size: 14px;"><strong>Reason:</strong> {{lost_reason}}</p>
    </div>
  </div>
</div>',
 ARRAY['full_name','company_name','email','classification','total_score','current_stage','lost_reason'])

on conflict (template_key) do nothing;
