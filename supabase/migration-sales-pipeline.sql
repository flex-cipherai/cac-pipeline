-- ============================================================
-- Sales pipeline: one pipeline per service line (safe to re-run)
--
-- Custom builds is the first (and for now only) service line. A prospect moves through three stages:
--
--   1. Scoper     ran the free Automation scoper on the website. Anonymous: the scoper no longer asks
--                 for name or email up front. These are rows in gap_assessments with no pipeline lead.
--   2. Active     gave their details at the end of the scoper, or asked for a custom build through a
--                 website form, or was added by staff. One row in pipeline_leads with stage 'active'.
--   3. Client     converted. stage 'client'. ('lost' takes a lead out of the board without deleting it.)
--
-- Every conversation with an active lead is logged in pipeline_activities with its medium (phone call,
-- e-meeting, physical meeting, email, WhatsApp). A lead with no logged interaction for 48 hours is
-- flagged on the board and the admins are emailed once (send-pipeline-alerts, hourly).
--
--   pipeline_leads        one row per prospect at stage 2 or 3, per service line
--   pipeline_activities   the interaction log; a trigger keeps pipeline_leads.last_interaction_at current
--
-- Access follows Settings → Permissions: the 'pipeline' module reads and writes; the dashboard can read.
-- Only admin can delete. Run after migration-role-permissions.sql and migration-gap-assessments.sql.
-- ============================================================


-- 1. The scoper no longer collects contact details up front -------------------------------------------

alter table public.gap_assessments alter column full_name drop not null;
alter table public.gap_assessments alter column email drop not null;
alter table public.gap_assessments alter column website_url drop not null;
alter table public.gap_assessments add column if not exists phone text;
-- direct | linkedin_organic | linkedin_paid | meta_organic | meta_paid | email | other
alter table public.gap_assessments add column if not exists source_channel text;
alter table public.gap_assessments add column if not exists contact_requested_at timestamptz;


-- 2. Leads -----------------------------------------------------------------------------------------

create table if not exists public.pipeline_leads (
  id uuid primary key default gen_random_uuid(),

  -- 'custom_build' today; an industry solution gets its own line ('industry:<slug>') and its own board.
  service_line text not null default 'custom_build',
  stage text not null default 'active' check (stage in ('active', 'client', 'lost')),

  -- Who
  full_name text not null,
  company_name text,
  email text,
  phone text,
  role_title text,
  website_url text,

  -- How they arrived. entry_point is the door; source_channel is where the visit came from.
  entry_point text not null default 'manual'
    check (entry_point in ('scoper', 'custom_build_form', 'manual')),
  source_channel text not null default 'other'
    check (source_channel in ('direct', 'linkedin_organic', 'linkedin_paid', 'meta_organic', 'meta_paid', 'email', 'other')),
  source_detail text,
  assessment_id uuid references public.gap_assessments(id) on delete set null,

  -- What they want
  summary text,
  staff_band text,
  sector text,
  estimated_value numeric(14, 2),
  currency text not null default 'KES',

  owner_id uuid references public.profiles(id) on delete set null,

  -- Follow-up state
  last_interaction_at timestamptz,
  stale_alerted_at timestamptz,

  -- Outcome
  won_at timestamptz,
  lost_at timestamptz,
  lost_reason text,

  -- Attribution
  page_url text,
  referrer text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,

  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pipeline_leads_board_idx on public.pipeline_leads (service_line, stage, created_at desc);
create index if not exists pipeline_leads_email_idx on public.pipeline_leads (lower(email));
create index if not exists pipeline_leads_assessment_idx on public.pipeline_leads (assessment_id);

alter table public.gap_assessments
  add column if not exists pipeline_lead_id uuid references public.pipeline_leads(id) on delete set null;

drop trigger if exists on_pipeline_leads_updated on public.pipeline_leads;
create trigger on_pipeline_leads_updated
  before update on public.pipeline_leads
  for each row execute function public.handle_updated_at();

-- Stamp won_at / lost_at when the stage changes, so reports never depend on the app remembering to.
create or replace function public.handle_pipeline_stage()
returns trigger
language plpgsql
as $$
begin
  if new.stage is distinct from old.stage then
    new.won_at := case when new.stage = 'client' then coalesce(new.won_at, now()) else null end;
    new.lost_at := case when new.stage = 'lost' then coalesce(new.lost_at, now()) else null end;
    if new.stage <> 'lost' then new.lost_reason := null; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists on_pipeline_leads_stage on public.pipeline_leads;
create trigger on_pipeline_leads_stage
  before update on public.pipeline_leads
  for each row execute function public.handle_pipeline_stage();


-- 3. Interaction log ---------------------------------------------------------------------------------
-- The five mediums are interactions and reset the 48-hour clock. 'note' and 'stage' (written by the app
-- when a lead moves) are kept on the timeline but do not count.

create table if not exists public.pipeline_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.pipeline_leads(id) on delete cascade,
  medium text not null
    check (medium in ('phone_call', 'e_meeting', 'physical_meeting', 'email', 'whatsapp', 'note', 'stage')),
  summary text,
  next_step text,
  occurred_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists pipeline_activities_lead_idx on public.pipeline_activities (lead_id, occurred_at desc);
create index if not exists pipeline_activities_recent_idx on public.pipeline_activities (created_at desc);

create or replace function public.handle_pipeline_touch()
returns trigger
language plpgsql
as $$
begin
  if new.medium in ('phone_call', 'e_meeting', 'physical_meeting', 'email', 'whatsapp') then
    update public.pipeline_leads
    set last_interaction_at = greatest(coalesce(last_interaction_at, new.occurred_at), new.occurred_at)
    where id = new.lead_id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_pipeline_activity_touch on public.pipeline_activities;
create trigger on_pipeline_activity_touch
  after insert on public.pipeline_activities
  for each row execute function public.handle_pipeline_touch();


-- 4. Row level security ------------------------------------------------------------------------------

alter table public.pipeline_leads enable row level security;
alter table public.pipeline_activities enable row level security;

drop policy if exists "Module access: view pipeline leads" on public.pipeline_leads;
create policy "Module access: view pipeline leads"
  on public.pipeline_leads for select to authenticated
  using (public.has_any_module_access(array['pipeline', 'dashboard']));

drop policy if exists "Module access: add pipeline leads" on public.pipeline_leads;
create policy "Module access: add pipeline leads"
  on public.pipeline_leads for insert to authenticated
  with check (public.has_module_access('pipeline'));

drop policy if exists "Module access: edit pipeline leads" on public.pipeline_leads;
create policy "Module access: edit pipeline leads"
  on public.pipeline_leads for update to authenticated
  using (public.has_module_access('pipeline'))
  with check (public.has_module_access('pipeline'));

drop policy if exists "Admins can delete pipeline leads" on public.pipeline_leads;
create policy "Admins can delete pipeline leads"
  on public.pipeline_leads for delete to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

drop policy if exists "Module access: view pipeline activities" on public.pipeline_activities;
create policy "Module access: view pipeline activities"
  on public.pipeline_activities for select to authenticated
  using (public.has_any_module_access(array['pipeline', 'dashboard']));

drop policy if exists "Module access: log pipeline activities" on public.pipeline_activities;
create policy "Module access: log pipeline activities"
  on public.pipeline_activities for insert to authenticated
  with check (public.has_module_access('pipeline') and created_by = auth.uid());

-- Fix a mistake in your own entry; admins can tidy anything.
drop policy if exists "Authors edit their pipeline activities" on public.pipeline_activities;
create policy "Authors edit their pipeline activities"
  on public.pipeline_activities for update to authenticated
  using (created_by = auth.uid() or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

drop policy if exists "Authors delete their pipeline activities" on public.pipeline_activities;
create policy "Authors delete their pipeline activities"
  on public.pipeline_activities for delete to authenticated
  using (created_by = auth.uid() or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- The scoper column on the board reads gap_assessments: let the pipeline module see them too.
drop policy if exists "Module access: view gap assessments" on public.gap_assessments;
create policy "Module access: view gap assessments"
  on public.gap_assessments for select to authenticated
  using (public.has_any_module_access(array['assessments', 'pipeline', 'dashboard']));

-- Staff move an old scoper run (one that already has contact details) into stage 2 from the board.
drop policy if exists "Module access: link gap assessments" on public.gap_assessments;
create policy "Module access: link gap assessments"
  on public.gap_assessments for update to authenticated
  using (public.has_module_access('pipeline'))
  with check (public.has_module_access('pipeline'));
revoke update on public.gap_assessments from authenticated;
grant update (pipeline_lead_id) on public.gap_assessments to authenticated;


-- 5. The 48-hour alert email (editable on the Notifications page) ----------------------------------------

insert into public.email_templates
  (template_key, name, recipient_type, description, subject, body_html, is_active, available_variables)
values
('pipeline_lead_stale', 'Pipeline: Lead With No Interaction (48h)', 'team',
 'Sent to admins when an active lead in the sales pipeline has had no logged interaction (call, meeting, email or WhatsApp) for 48 hours. Once per lead per quiet spell; logging an interaction resets it.',
 '{{total_count}} pipeline leads have had no contact for 48 hours',
 '<div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #201E1D;">
  <div style="padding: 32px 0 24px; text-align: center;">
    <span style="font-size: 22px; font-weight: 700; color: #EC3013;">SDFM GROUP</span>
    <span style="font-size: 12px; display: block; letter-spacing: 0.15em; color: #201E1D;">LIMITED</span>
  </div>
  <div style="background: #F3F2F2; border-radius: 10px; padding: 32px; margin-bottom: 24px;">
    <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 8px;">Leads going cold</h1>
    <p style="font-size: 14px; color: #666; margin: 0 0 16px; line-height: 1.6;">Hi {{recipient_name}}. These active leads have had no logged interaction for 48 hours or more.</p>
    <div style="background: white; border-radius: 8px; padding: 4px 20px 16px; border-left: 4px solid #EC3013;">
      {{items_html}}
    </div>
    <p style="margin: 24px 0 0;"><a href="{{app_link}}" style="display: inline-block; background: #D82A10; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 700; padding: 12px 24px; border-radius: 6px;">Open the pipeline</a></p>
  </div>
  <p style="font-size: 12px; color: #999; text-align: center;">SDFM Group Limited · Internal alert</p>
</div>',
 true,
 ARRAY['recipient_name', 'total_count', 'items_html', 'app_link'])
on conflict (template_key) do nothing;
