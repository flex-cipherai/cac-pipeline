-- ============================================================
-- Social Media Management System — Phase 1 (LinkedIn, Assisted Mode)
-- Core data model: connected accounts, content pillars/campaigns,
-- media library, posts, approvals, analytics, activity.
--
-- Reuses existing conventions from schema.sql:
--   - profiles.role RLS pattern ('admin' / 'marketing' here — 'sales'
--     has no access to this module, matching the spec's role table)
--   - public.handle_updated_at() trigger for updated_at columns
--   - system_settings key/value rows for module configuration
--
-- Run this in the Supabase SQL Editor (all at once), after schema.sql.
-- ============================================================

-- 1. Connected Accounts (LinkedIn today; more platforms added the same way)
create table if not exists public.connected_accounts (
  id uuid primary key default gen_random_uuid(),
  platform text not null default 'linkedin' check (platform in ('linkedin')),
  account_name text not null,
  mode text not null default 'assisted' check (mode in ('assisted', 'automated')),
  status text not null default 'active' check (status in ('active', 'disconnected')),
  external_page_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.connected_accounts enable row level security;

create policy "Content team can view connected accounts"
  on public.connected_accounts for select
  to authenticated
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'marketing'))
  );

create policy "Admins can manage connected accounts"
  on public.connected_accounts for all
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create trigger on_connected_accounts_updated
  before update on public.connected_accounts
  for each row execute function public.handle_updated_at();

-- Seed SDFM's one LinkedIn Company Page (Phase 1 scope)
insert into public.connected_accounts (platform, account_name, mode, status)
select 'linkedin', 'SDFM Group Limited', 'assisted', 'active'
where not exists (select 1 from public.connected_accounts where platform = 'linkedin');


-- 2. Content Pillars
create table if not exists public.content_pillars (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text not null default '#EC3013',
  created_at timestamptz default now()
);

alter table public.content_pillars enable row level security;

create policy "Content team can view pillars"
  on public.content_pillars for select
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'marketing')));

create policy "Content team can manage pillars"
  on public.content_pillars for all
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'marketing')))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'marketing')));


-- 3. Content Campaigns
create table if not exists public.content_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  objective text,
  target_metric text check (target_metric in ('impressions', 'follower_growth', 'engagement_rate', 'website_traffic', 'discovery_calls')),
  target_value numeric,
  start_date date,
  end_date date,
  created_at timestamptz default now()
);

alter table public.content_campaigns enable row level security;

create policy "Content team can view campaigns"
  on public.content_campaigns for select
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'marketing')));

create policy "Content team can manage campaigns"
  on public.content_campaigns for all
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'marketing')))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'marketing')));


-- 4. Content Assets (media library)
create table if not exists public.content_assets (
  id uuid primary key default gen_random_uuid(),
  file_path text not null,
  file_name text not null,
  file_type text not null check (file_type in ('image', 'video', 'document')),
  file_size bigint,
  tags text[] default '{}',
  source_project text,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz default now()
);

alter table public.content_assets enable row level security;

create policy "Content team can view assets"
  on public.content_assets for select
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'marketing')));

create policy "Content team can manage assets"
  on public.content_assets for all
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'marketing')))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'marketing')));


-- 5. Posts (the composer/calendar entity)
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.connected_accounts(id),
  post_type text not null default 'text' check (post_type in ('text', 'image', 'carousel', 'video', 'poll')),
  caption text default '',
  hashtags text[] default '{}',
  mentions text[] default '{}',
  pillar_id uuid references public.content_pillars(id),
  campaign_id uuid references public.content_campaigns(id),
  status text not null default 'draft' check (status in ('draft', 'pending_approval', 'changes_requested', 'scheduled', 'ready_to_post', 'posted', 'failed')),
  scheduled_at timestamptz,
  posted_at timestamptz,
  utm_url text,
  mode text not null default 'assisted' check (mode in ('assisted', 'automated')),
  poll_options jsonb,
  is_template boolean default false,
  template_name text,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.posts enable row level security;

create policy "Content team can view posts"
  on public.posts for select
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'marketing')));

create policy "Content team can manage posts"
  on public.posts for all
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'marketing')))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'marketing')));

create trigger on_posts_updated
  before update on public.posts
  for each row execute function public.handle_updated_at();

create index if not exists posts_status_scheduled_idx on public.posts (status, scheduled_at);


-- 6. Post Assets (join table — ordered media per post)
create table if not exists public.post_assets (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  asset_id uuid not null references public.content_assets(id) on delete cascade,
  position integer default 0
);

alter table public.post_assets enable row level security;

create policy "Content team can view post assets"
  on public.post_assets for select
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'marketing')));

create policy "Content team can manage post assets"
  on public.post_assets for all
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'marketing')))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'marketing')));


-- 7. Post Approval History
create table if not exists public.post_approval_history (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  action text not null check (action in ('submitted', 'approved', 'changes_requested', 'rejected')),
  comment text,
  actor_id uuid references public.profiles(id),
  created_at timestamptz default now()
);

alter table public.post_approval_history enable row level security;

create policy "Content team can view approval history"
  on public.post_approval_history for select
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'marketing')));

-- Anyone on the content team can submit for approval; only Admin can decide
-- (approve / request changes / reject) — matches the spec's role table.
create policy "Content team can submit, admin can decide"
  on public.post_approval_history for insert
  to authenticated
  with check (
    (action = 'submitted' and exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'marketing')))
    or
    (action in ('approved', 'changes_requested', 'rejected') and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  );


-- 8. Analytics Snapshots (manual entry, CSV import, or future API pull)
create table if not exists public.analytics_snapshots (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.connected_accounts(id),
  post_id uuid references public.posts(id) on delete cascade,
  captured_at timestamptz not null default now(),
  source text not null default 'manual' check (source in ('manual', 'csv_import', 'api')),
  impressions integer default 0,
  reach integer default 0,
  engagement_rate numeric default 0,
  reactions integer default 0,
  comments integer default 0,
  shares integer default 0,
  clicks integer default 0,
  video_views integer default 0,
  follower_count integer,
  created_at timestamptz default now()
);

alter table public.analytics_snapshots enable row level security;

create policy "Content team can view analytics"
  on public.analytics_snapshots for select
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'marketing')));

create policy "Content team can log analytics"
  on public.analytics_snapshots for all
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'marketing')))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'marketing')));

create index if not exists analytics_snapshots_captured_idx on public.analytics_snapshots (captured_at);


-- 9. Activity Events (comments, reactions, mentions, follower growth)
create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.connected_accounts(id),
  post_id uuid references public.posts(id) on delete set null,
  event_type text not null check (event_type in ('comment', 'reaction', 'mention', 'follower_milestone')),
  content text,
  author_name text,
  triage_status text not null default 'needs_response' check (triage_status in ('needs_response', 'handled', 'ignored')),
  occurred_at timestamptz not null default now(),
  external_url text,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now()
);

alter table public.activity_events enable row level security;

create policy "Content team can view activity"
  on public.activity_events for select
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'marketing')));

create policy "Content team can manage activity"
  on public.activity_events for all
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'marketing')))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'marketing')));

create index if not exists activity_events_occurred_idx on public.activity_events (occurred_at desc);


-- 10. Hashtag Sets (reusable hashtag library, by content pillar)
create table if not exists public.hashtag_sets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  pillar_id uuid references public.content_pillars(id),
  hashtags text[] not null default '{}',
  created_at timestamptz default now()
);

alter table public.hashtag_sets enable row level security;

create policy "Content team can view hashtag sets"
  on public.hashtag_sets for select
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'marketing')));

create policy "Content team can manage hashtag sets"
  on public.hashtag_sets for all
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'marketing')))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'marketing')));


-- 11. Storage bucket for the content library (private — access via RLS below)
insert into storage.buckets (id, name, public)
values ('content-library', 'content-library', false)
on conflict (id) do nothing;

create policy "Content team can read content library files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'content-library'
    and exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'marketing'))
  );

create policy "Content team can upload content library files"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'content-library'
    and exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'marketing'))
  );

create policy "Content team can update content library files"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'content-library'
    and exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'marketing'))
  );

create policy "Content team can delete content library files"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'content-library'
    and exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'marketing'))
  );


-- 12. Module configuration (system_settings key/value — same table as booking config)
-- app_base_url is used by Edge Functions to build links in emails (e.g. the
-- Netlify site URL) — set it once in Settings once the site is deployed.
insert into public.system_settings (key, value) values
  ('sm_approval_workflow_enabled', 'false'),
  ('sm_default_utm_source', 'linkedin'),
  ('sm_default_utm_medium', 'social'),
  ('sm_signature_link', ''),
  ('app_base_url', '')
on conflict (key) do nothing;
