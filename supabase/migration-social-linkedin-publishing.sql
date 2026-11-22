-- ============================================================
-- Social Media Management — LinkedIn Automated Mode
-- (Community Management API: publishing, analytics sync, comment sync)
--
-- 1. connected_accounts gains account_type ('organization' = the Company
--    Page, 'member' = a person's own LinkedIn profile) and owner_profile_id
--    (the BMS user a member profile belongs to). The OAuth callback creates
--    the member row for whoever connects.
-- 2. posts gains the publishing state: the LinkedIn post URN once
--    published, the last error, the in-flight upload state (videos are
--    processed by LinkedIn before they can be posted) and the lifetime
--    stats last pulled (analytics_snapshots store deltas, so the sync needs
--    the previous totals). New status 'publishing'.
-- 3. A person's profile can only be chosen as the author of a post by that
--    person (enforced by trigger, not just in the UI).
-- 4. activity_events gains external_id so synced comments are not
--    duplicated.
-- 5. Email template for failed publishes.
--
-- Run after migration-social-linkedin-oauth.sql and
-- migration-permissions-enforcement.sql. Safe to run more than once.
-- ============================================================

-- 1. Accounts
alter table public.connected_accounts
  add column if not exists account_type text not null default 'organization',
  add column if not exists owner_profile_id uuid references public.profiles(id) on delete cascade,
  add column if not exists last_synced_at timestamptz,
  add column if not exists last_sync_error text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'connected_accounts_account_type_check') then
    alter table public.connected_accounts
      add constraint connected_accounts_account_type_check check (account_type in ('organization', 'member'));
  end if;
end $$;

-- One member account per BMS user.
create unique index if not exists connected_accounts_member_owner_idx
  on public.connected_accounts (owner_profile_id) where account_type = 'member';

-- 2. Posts
alter table public.posts
  add column if not exists external_post_urn text,
  add column if not exists external_post_url text,
  add column if not exists publish_error text,
  add column if not exists publish_attempts integer not null default 0,
  add column if not exists publish_state jsonb,
  add column if not exists publish_lock_until timestamptz,
  add column if not exists last_stats jsonb,
  add column if not exists stats_synced_at timestamptz,
  add column if not exists poll_question text,
  add column if not exists poll_duration text not null default 'THREE_DAYS';

alter table public.posts drop constraint if exists posts_status_check;
alter table public.posts add constraint posts_status_check check (status in (
  'draft', 'pending_approval', 'changes_requested', 'scheduled', 'publishing', 'ready_to_post', 'posted', 'failed'
));

create index if not exists posts_external_post_urn_idx on public.posts (external_post_urn) where external_post_urn is not null;

-- 3. Only the owner may make their own profile the author of a post.
-- Checked on insert and whenever account_id changes; later edits by the
-- content team (rescheduling, captions) are allowed. Service-role calls
-- (Edge Functions) have no auth.uid() and are not restricted.
create or replace function public.check_post_account_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  acct record;
begin
  if new.account_id is null or auth.uid() is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.account_id is not distinct from old.account_id then
    return new;
  end if;
  select account_type, owner_profile_id into acct from public.connected_accounts where id = new.account_id;
  if acct.account_type = 'member' and acct.owner_profile_id is distinct from auth.uid() then
    raise exception 'Only the owner of a LinkedIn profile can schedule posts to it';
  end if;
  return new;
end;
$$;

drop trigger if exists on_posts_check_account_owner on public.posts;
create trigger on_posts_check_account_owner
  before insert or update on public.posts
  for each row execute function public.check_post_account_owner();

-- 4. Activity events
alter table public.activity_events
  add column if not exists external_id text,
  add column if not exists source text not null default 'manual';

-- Not partial, so it can back an upsert's ON CONFLICT (external_id); manual
-- entries have a NULL external_id and never clash.
create unique index if not exists activity_events_external_id_idx
  on public.activity_events (external_id);

-- 5. Failed-publish alert
insert into public.email_templates
  (template_key, name, recipient_type, description, subject, body_html, is_active, available_variables)
values
('sm_post_failed', 'Post Failed to Publish', 'team',
 'Sent when a scheduled post could not be published to LinkedIn automatically.',
 'A LinkedIn post failed to publish',
 '<div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #201E1D;">
  <div style="padding: 32px 0 24px; text-align: center;">
    <span style="font-size: 22px; font-weight: 700; color: #EC3013;">SDFM GROUP</span>
    <span style="font-size: 12px; display: block; letter-spacing: 0.15em; color: #201E1D;">LIMITED</span>
  </div>
  <div style="background: #F3F2F2; border-radius: 10px; padding: 32px; margin-bottom: 24px;">
    <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 8px;">A post failed to publish</h1>
    <p style="font-size: 14px; color: #666; margin: 0 0 24px;">It was scheduled for {{scheduled_for}} on {{account_name}}. LinkedIn said: {{error}}</p>
    <div style="background: white; border-radius: 8px; padding: 20px; border-left: 4px solid #EC3013;">
      <p style="margin: 0; font-size: 14px; color: #666;">{{post_caption_preview}}</p>
    </div>
    <p style="font-size: 13px; color: #666; margin: 24px 0 0;">Retry it or post it manually from the <a href="{{calendar_link}}" style="color: #EC3013; font-weight: 600;">Content Calendar</a>.</p>
  </div>
  <p style="font-size: 12px; color: #999; text-align: center;">SDFM Group Limited · Transforming Kenyan Businesses</p>
</div>',
 true,
 ARRAY['scheduled_for','account_name','error','post_caption_preview','calendar_link'])
on conflict (template_key) do nothing;
