-- ============================================================
-- AI Gap Check — the free assessment tool on sdfmgroup.com/ai-gap-check (safe to re-run)
--
-- A visitor gives their details, talks to an AI interviewer, and gets a gap report with projected ROI.
-- The public website never touches these tables: everything goes through the gap-assessment Edge Function
-- (service role). Staff read them in the CRM under AI Gap Checks.
--
--   gap_assessments           one row per session: contact details, progress, the finished report
--   gap_assessment_messages   the conversation, in order
--
-- Access follows Settings → Permissions (module 'assessments') through has_module_access(); admin always
-- has it, only admin can delete. The tool's questions, ROI assumptions, model and limits live in
-- system_settings under the ga_* keys, edited in Settings → Assessment tool (admin only).
--
-- report            what the visitor saw and can download. It has NO priorities and NO costs.
-- report_internal   the working behind the ROI figures (people, hours, hourly cost, estimated investment).
--                   Staff only: it is what the paid assessment sells.
--
-- Run in the Supabase SQL Editor after migration-inquiries.sql and migration-role-permissions.sql.
-- ============================================================


-- 1. Sessions ----------------------------------------------------------------

create table if not exists public.gap_assessments (
  id uuid primary key default gen_random_uuid(),

  -- The browser holds the token; only its hash is stored.
  token_hash text not null unique,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'report_ready')),

  -- Who
  full_name text not null,
  email text not null,
  email_domain text,
  company_name text not null,
  website_url text not null,
  website_summary text,

  -- Progress
  areas_covered text[] not null default '{}',
  user_turns integer not null default 0,
  last_activity_at timestamptz not null default now(),
  -- Set while a model call for this session is running, so two taps cannot run two at once.
  processing_since timestamptz,

  -- Result
  report jsonb,
  report_internal jsonb,
  report_generated_at timestamptz,

  -- Cost and quota tracking
  model text,
  llm_calls integer not null default 0,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,

  -- What they did with the report
  pdf_downloaded_at timestamptz,
  cta_clicked_at timestamptz,
  cta_kind text,

  -- The inquiry created when the report was ready, so sales follow it up in Inquiries.
  inquiry_id uuid references public.inquiries(id) on delete set null,

  -- Attribution
  page_url text,
  referrer text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  ip_hash text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists gap_assessments_created_idx on public.gap_assessments (created_at desc);
create index if not exists gap_assessments_status_idx on public.gap_assessments (status, created_at desc);
create index if not exists gap_assessments_email_idx on public.gap_assessments (lower(email), created_at desc);
create index if not exists gap_assessments_inquiry_idx on public.gap_assessments (inquiry_id);

drop trigger if exists on_gap_assessments_updated on public.gap_assessments;
create trigger on_gap_assessments_updated
  before update on public.gap_assessments
  for each row execute function public.handle_updated_at();


-- 2. Conversation ------------------------------------------------------------

create table if not exists public.gap_assessment_messages (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.gap_assessments(id) on delete cascade,
  seq integer not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now(),
  unique (assessment_id, seq)
);


-- 3. Row level security ------------------------------------------------------
-- No insert or update policy: only the Edge Function (service role) writes these.

alter table public.gap_assessments enable row level security;
alter table public.gap_assessment_messages enable row level security;

drop policy if exists "Module access: view gap assessments" on public.gap_assessments;
create policy "Module access: view gap assessments"
  on public.gap_assessments for select to authenticated
  using (public.has_module_access('assessments'));

drop policy if exists "Admins can delete gap assessments" on public.gap_assessments;
create policy "Admins can delete gap assessments"
  on public.gap_assessments for delete to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

drop policy if exists "Module access: view gap assessment messages" on public.gap_assessment_messages;
create policy "Module access: view gap assessment messages"
  on public.gap_assessment_messages for select to authenticated
  using (public.has_module_access('assessments'));


-- 4. Permissions: the 'assessments' module (sales on, marketing off; admin always) -----------------

insert into public.role_permissions (role, module, allowed)
values ('sales', 'assessments', true), ('marketing', 'assessments', false)
on conflict (role, module) do nothing;


-- 5. Inquiries: a finished Gap Check is logged as an inquiry with offer 'gap_check' ------------------
-- (migration-website-leads.sql adds these columns and the same constraint; both files agree.)

alter table public.inquiries add column if not exists offer text;
alter table public.inquiries add column if not exists staff_band text;
alter table public.inquiries drop constraint if exists inquiries_offer_check;
alter table public.inquiries
  add constraint inquiries_offer_check
  check (offer is null or offer in ('assessment', 'guide', 'industry', 'custom', 'contact', 'gap_check'));


-- 6. Housekeeping ------------------------------------------------------------
-- Unfinished sessions hold a stranger's business details for no reason after a month. Call this from
-- pg_cron if you want it automatic (select cron.schedule('purge-gap-checks', '17 3 * * *', 'select public.purge_stale_gap_assessments()')).

create or replace function public.purge_stale_gap_assessments(p_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.gap_assessments
  where status = 'in_progress' and last_activity_at < now() - make_interval(days => greatest(p_days, 7));
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.purge_stale_gap_assessments(integer) from public, anon, authenticated;


-- Review: the new tables should show only the policies above.
select tablename, policyname, cmd
from pg_policies
where tablename in ('gap_assessments', 'gap_assessment_messages')
order by tablename, cmd, policyname;
