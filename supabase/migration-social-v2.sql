-- ============================================================
-- Social Media Management v2 — multi-platform, Metricool-style
--
-- 1. Platforms: connected_accounts accepts the platforms the BMS is built to
--    take next (Meta, TikTok, X, YouTube); each has a connector in
--    supabase/functions/_shared/platforms/ once it is built.
-- 2. Posts: composed once for several accounts → one row per account sharing
--    post_group_id; first comment; recurrence; autolist membership.
-- 3. Queues: posting_slots (per-account weekly time slots).
-- 4. Evergreen: autolists + autolist_items (content recycled into slots).
-- 5. Inbox replies: activity_events.direction / parent / replied_at.
-- 6. Scheduled reports: report_schedules.
-- 7. Link in Bio: bio_pages + bio_links (public page served by the
--    bio-page Edge Function — no table is readable by anonymous users).
-- 8. social_best_times view (engagement by weekday and hour).
-- 9. Permission modules social_reports and social_links.
--
-- Run after migration-social-linkedin-publishing.sql and
-- migration-permissions-enforcement.sql. Safe to run more than once.
-- ============================================================

-- 1. Platforms ---------------------------------------------------------------
alter table public.connected_accounts drop constraint if exists connected_accounts_platform_check;
alter table public.connected_accounts add constraint connected_accounts_platform_check
  check (platform in ('linkedin', 'facebook', 'instagram', 'threads', 'tiktok', 'x', 'youtube'));

alter table public.connected_accounts drop constraint if exists connected_accounts_account_type_check;
alter table public.connected_accounts add constraint connected_accounts_account_type_check
  check (account_type in ('organization', 'member', 'page', 'business', 'creator', 'profile'));

alter table public.connected_accounts
  add column if not exists avatar_url text,
  add column if not exists timezone text not null default 'Africa/Nairobi';

-- One row per external account per platform (was LinkedIn-organization only).
drop index if exists connected_accounts_org_page_idx;
create unique index if not exists connected_accounts_platform_external_idx
  on public.connected_accounts (platform, external_page_id)
  where external_page_id is not null;


-- 2. Posts ---------------------------------------------------------------------
alter table public.posts
  add column if not exists post_group_id uuid,
  add column if not exists first_comment text,
  add column if not exists first_comment_urn text,
  add column if not exists first_comment_error text,
  add column if not exists recurrence jsonb,
  add column if not exists recurrence_parent_id uuid references public.posts(id) on delete set null,
  add column if not exists occurrence integer not null default 1,
  add column if not exists autolist_id uuid,
  add column if not exists queued boolean not null default false;

update public.posts set post_group_id = id where post_group_id is null;

create or replace function public.posts_default_group()
returns trigger language plpgsql as $$
begin
  if new.post_group_id is null then new.post_group_id := new.id; end if;
  return new;
end;
$$;

drop trigger if exists on_posts_default_group on public.posts;
create trigger on_posts_default_group
  before insert on public.posts
  for each row execute function public.posts_default_group();

create index if not exists posts_group_idx on public.posts (post_group_id);
create index if not exists posts_account_scheduled_idx on public.posts (account_id, scheduled_at);


-- 3. Queues -------------------------------------------------------------------
create table if not exists public.posting_slots (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.connected_accounts(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7), -- ISO: 1 = Monday
  slot_time time not null,
  active boolean not null default true,
  created_at timestamptz default now(),
  unique (account_id, weekday, slot_time)
);
alter table public.posting_slots enable row level security;


-- 4. Evergreen autolists -------------------------------------------------------
create table if not exists public.autolists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  account_ids uuid[] not null default '{}',
  slots jsonb not null default '[]', -- [{ "weekday": 2, "time": "09:00" }]
  timezone text not null default 'Africa/Nairobi',
  avoid_repeat_days integer not null default 30,
  active boolean not null default true,
  cursor integer not null default 0,
  filled_until timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.autolists enable row level security;

drop trigger if exists on_autolists_updated on public.autolists;
create trigger on_autolists_updated before update on public.autolists
  for each row execute function public.handle_updated_at();

-- Items are template posts (is_template = true, autolist_id set) so they keep
-- media, type, hashtags, pillar and campaign like any other post.
create table if not exists public.autolist_items (
  id uuid primary key default gen_random_uuid(),
  autolist_id uuid not null references public.autolists(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  position integer not null default 0,
  use_count integer not null default 0,
  last_used_at timestamptz,
  created_at timestamptz default now(),
  unique (autolist_id, post_id)
);
alter table public.autolist_items enable row level security;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'posts_autolist_id_fkey') then
    alter table public.posts add constraint posts_autolist_id_fkey
      foreign key (autolist_id) references public.autolists(id) on delete set null;
  end if;
end $$;


-- 5. Inbox replies --------------------------------------------------------------
alter table public.activity_events
  add column if not exists direction text not null default 'inbound',
  add column if not exists parent_external_id text,
  add column if not exists replied_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'activity_events_direction_check') then
    alter table public.activity_events add constraint activity_events_direction_check
      check (direction in ('inbound', 'outbound'));
  end if;
end $$;


-- 6. Scheduled reports -----------------------------------------------------------
create table if not exists public.report_schedules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  account_ids uuid[] not null default '{}', -- empty = all accounts
  frequency text not null default 'weekly' check (frequency in ('weekly', 'monthly')),
  send_weekday smallint not null default 1 check (send_weekday between 1 and 7),
  recipients text[] not null default '{}',
  sections text[] not null default array['overview', 'top_posts', 'best_times', 'formats'],
  active boolean not null default true,
  last_sent_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.report_schedules enable row level security;

drop trigger if exists on_report_schedules_updated on public.report_schedules;
create trigger on_report_schedules_updated before update on public.report_schedules
  for each row execute function public.handle_updated_at();


-- 7. Link in Bio -------------------------------------------------------------------
create table if not exists public.bio_pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  title text not null,
  bio text,
  avatar_url text,
  theme jsonb not null default '{"background":"#F3F2F2","button":"#EC3013","text":"#201E1D"}',
  account_ids uuid[] not null default '{}', -- latest posts from these accounts
  show_latest_posts boolean not null default true,
  published boolean not null default false,
  views integer not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.bio_pages enable row level security;

drop trigger if exists on_bio_pages_updated on public.bio_pages;
create trigger on_bio_pages_updated before update on public.bio_pages
  for each row execute function public.handle_updated_at();

create table if not exists public.bio_links (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.bio_pages(id) on delete cascade,
  label text not null,
  url text not null,
  position integer not null default 0,
  active boolean not null default true,
  add_utm boolean not null default true,
  clicks integer not null default 0,
  created_at timestamptz default now()
);
alter table public.bio_links enable row level security;


-- 8. Best times ----------------------------------------------------------------------
-- One row per account × weekday × hour (account's timezone) from published
-- posts with synced lifetime stats. security_invoker → caller's RLS applies.
create or replace view public.social_best_times with (security_invoker = true) as
select
  p.account_id,
  extract(isodow from p.posted_at at time zone coalesce(a.timezone, 'Africa/Nairobi'))::int as weekday,
  extract(hour from p.posted_at at time zone coalesce(a.timezone, 'Africa/Nairobi'))::int as hour,
  count(*)::int as posts,
  round(avg(coalesce((p.last_stats->>'impressions')::numeric, 0)), 1) as avg_impressions,
  round(avg(case when coalesce((p.last_stats->>'impressions')::numeric, 0) > 0
    then (coalesce((p.last_stats->>'reactions')::numeric, 0) + coalesce((p.last_stats->>'comments')::numeric, 0)
          + coalesce((p.last_stats->>'shares')::numeric, 0) + coalesce((p.last_stats->>'clicks')::numeric, 0))
         / (p.last_stats->>'impressions')::numeric * 100 end), 2) as avg_engagement_rate
from public.posts p
join public.connected_accounts a on a.id = p.account_id
where p.status = 'posted' and p.posted_at is not null and p.last_stats is not null
group by 1, 2, 3;


-- 9. Policies ----------------------------------------------------------------------
-- Planning tables follow the content modules; reports and bio pages their own.
do $$
declare
  content text := 'public.has_any_module_access(array[''social_calendar'', ''social_composer'', ''social_bulk'', ''social_library'', ''social_approvals''])';
  reports text := 'public.has_any_module_access(array[''social_reports''])';
  links   text := 'public.has_any_module_access(array[''social_links''])';
  t record;
begin
  for t in select * from (values
    ('posting_slots', content), ('autolists', content), ('autolist_items', content),
    ('report_schedules', reports), ('bio_pages', links), ('bio_links', links)
  ) as v(tbl, expr) loop
    execute format('drop policy if exists "Module access: all" on public.%I', t.tbl);
    execute format('create policy "Module access: all" on public.%I for all to authenticated using (%s) with check (%s)', t.tbl, t.expr, t.expr);
  end loop;

  -- Reports and bio pages read posts, stats and accounts (additive read policies).
  execute 'drop policy if exists "Reports and bio: view" on public.posts';
  execute format('create policy "Reports and bio: view" on public.posts for select to authenticated using (public.has_any_module_access(array[''social_reports'', ''social_links'']))');
  execute 'drop policy if exists "Reports: view" on public.analytics_snapshots';
  execute format('create policy "Reports: view" on public.analytics_snapshots for select to authenticated using (%s)', reports);
  execute 'drop policy if exists "Reports and bio: view" on public.connected_accounts';
  execute format('create policy "Reports and bio: view" on public.connected_accounts for select to authenticated using (public.has_any_module_access(array[''social_reports'', ''social_links'']))');
end $$;


-- 10. Permission modules (same defaults as the other social modules) -----------------
insert into public.role_permissions (role, module, allowed)
select r.role, m.module, (r.role = 'marketing')
from (values ('social_reports'), ('social_links')) as m(module)
cross join (select distinct role from public.role_permissions where role <> 'admin') as r
on conflict do nothing;

-- The weekly digest becomes the first scheduled report (sent to the content team).
insert into public.report_schedules (name, frequency, send_weekday, recipients)
select 'Weekly performance', 'weekly', 1, '{}'
where not exists (select 1 from public.report_schedules);
