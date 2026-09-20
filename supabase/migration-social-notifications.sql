-- ============================================================
-- Social Media Management — Notifications & Alerts (spec §6.9)
--
-- 1. in_app_notifications: the in-app alert feed. Notifications.jsx is a
--    template *editor*, not a feed — this is the actual per-user bell/list
--    the spec calls for (approval requests, decisions, milestones, etc).
-- 2. New email_templates rows for the same events, following the exact
--    shape/branding of the existing SDFM templates (team-facing only —
--    these are internal alerts, not lead-facing).
--
-- Run this in the Supabase SQL Editor, after migration-social-media.sql.
-- ============================================================

-- 1. In-app notifications
create table if not exists public.in_app_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  is_read boolean default false,
  created_at timestamptz default now()
);

alter table public.in_app_notifications enable row level security;

create policy "Users can view their own notifications"
  on public.in_app_notifications for select
  to authenticated
  using (user_id = auth.uid());

create policy "Users can mark their own notifications read"
  on public.in_app_notifications for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- The content team can notify each other (e.g. marketing notifying admin of
-- a submission, admin notifying marketing of a decision). Edge functions
-- use the service role and bypass this anyway.
create policy "Content team can create notifications"
  on public.in_app_notifications for insert
  to authenticated
  with check (exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'marketing')));

create index if not exists in_app_notifications_user_unread_idx on public.in_app_notifications (user_id, is_read);


-- 2. Email templates for social media events (team-facing)
insert into public.email_templates
  (template_key, name, recipient_type, description, subject, body_html, is_active, available_variables)
values

('sm_approval_requested', 'Post Submitted for Approval', 'team',
 'Sent to the Admin when a post is submitted for approval.',
 'Post Awaiting Approval — {{pillar}}',
 '<div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #201E1D;">
  <div style="padding: 32px 0 24px; text-align: center;">
    <span style="font-size: 22px; font-weight: 700; color: #EC3013;">SDFM GROUP</span>
    <span style="font-size: 12px; display: block; letter-spacing: 0.15em; color: #201E1D;">LIMITED</span>
  </div>
  <div style="background: #F3F2F2; border-radius: 10px; padding: 32px; margin-bottom: 24px;">
    <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 8px;">Post Awaiting Your Approval</h1>
    <p style="font-size: 14px; color: #666; margin: 0 0 24px;">{{submitted_by}} submitted a LinkedIn post for review.</p>
    <div style="background: white; border-radius: 8px; padding: 20px; border-left: 4px solid #EC3013;">
      <p style="margin: 0 0 8px; font-size: 14px;"><strong>Pillar:</strong> {{pillar}}</p>
      <p style="margin: 0 0 8px; font-size: 14px;"><strong>Scheduled for:</strong> {{scheduled_for}}</p>
      <p style="margin: 0; font-size: 14px; color: #666;">{{post_caption_preview}}</p>
    </div>
    <p style="font-size: 13px; color: #666; margin: 24px 0 0;">Review it in the <a href="{{review_link}}" style="color: #EC3013; font-weight: 600;">Approval Queue</a>.</p>
  </div>
  <p style="font-size: 12px; color: #999; text-align: center;">SDFM Group Limited · Transforming Kenyan Businesses</p>
</div>',
 false,
 ARRAY['submitted_by','pillar','scheduled_for','post_caption_preview','review_link']),

('sm_approval_decision', 'Post Approval Decision', 'team',
 'Sent to the post author when their submission is approved, sent back for changes, or rejected.',
 'Your Post Was {{decision}}',
 '<div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #201E1D;">
  <div style="padding: 32px 0 24px; text-align: center;">
    <span style="font-size: 22px; font-weight: 700; color: #EC3013;">SDFM GROUP</span>
    <span style="font-size: 12px; display: block; letter-spacing: 0.15em; color: #201E1D;">LIMITED</span>
  </div>
  <div style="background: #F3F2F2; border-radius: 10px; padding: 32px; margin-bottom: 24px;">
    <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 8px;">Your post was {{decision}}</h1>
    <p style="font-size: 14px; color: #666; margin: 0 0 24px;">Decision by {{decided_by}}.</p>
    <div style="background: white; border-radius: 8px; padding: 20px; border-left: 4px solid #EC3013;">
      <p style="margin: 0 0 8px; font-size: 14px; color: #666;">{{post_caption_preview}}</p>
      <p style="margin: 0; font-size: 14px;"><strong>Comment:</strong> {{comment}}</p>
    </div>
    <p style="font-size: 13px; color: #666; margin: 24px 0 0;">View it in the <a href="{{review_link}}" style="color: #EC3013; font-weight: 600;">Content Calendar</a>.</p>
  </div>
  <p style="font-size: 12px; color: #999; text-align: center;">SDFM Group Limited · Transforming Kenyan Businesses</p>
</div>',
 false,
 ARRAY['decision','decided_by','comment','post_caption_preview','review_link']),

('sm_post_ready', 'Post Ready to Publish', 'team',
 'Sent when a scheduled post moves into the Ready to Post queue (Assisted Mode).',
 'Post Ready to Publish on LinkedIn',
 '<div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #201E1D;">
  <div style="padding: 32px 0 24px; text-align: center;">
    <span style="font-size: 22px; font-weight: 700; color: #EC3013;">SDFM GROUP</span>
    <span style="font-size: 12px; display: block; letter-spacing: 0.15em; color: #201E1D;">LIMITED</span>
  </div>
  <div style="background: #F3F2F2; border-radius: 10px; padding: 32px; margin-bottom: 24px;">
    <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 8px;">A post is ready to publish</h1>
    <p style="font-size: 14px; color: #666; margin: 0 0 24px;">It was scheduled for {{scheduled_for}} and is now waiting in the Ready to Post queue.</p>
    <div style="background: white; border-radius: 8px; padding: 20px; border-left: 4px solid #EC3013;">
      <p style="margin: 0; font-size: 14px; color: #666;">{{post_caption_preview}}</p>
    </div>
    <p style="font-size: 13px; color: #666; margin: 24px 0 0;">Post it from the <a href="{{calendar_link}}" style="color: #EC3013; font-weight: 600;">Content Calendar</a>.</p>
  </div>
  <p style="font-size: 12px; color: #999; text-align: center;">SDFM Group Limited · Transforming Kenyan Businesses</p>
</div>',
 false,
 ARRAY['scheduled_for','post_caption_preview','calendar_link']),

('sm_follower_milestone', 'Follower Milestone Reached', 'team',
 'Sent when the LinkedIn Company Page crosses a follower milestone (100, 500, 1000, ...).',
 '{{account_name}} just hit {{milestone}} followers on LinkedIn',
 '<div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #201E1D;">
  <div style="padding: 32px 0 24px; text-align: center;">
    <span style="font-size: 22px; font-weight: 700; color: #EC3013;">SDFM GROUP</span>
    <span style="font-size: 12px; display: block; letter-spacing: 0.15em; color: #201E1D;">LIMITED</span>
  </div>
  <div style="background: #F3F2F2; border-radius: 10px; padding: 32px; margin-bottom: 24px;">
    <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 8px;">🎉 {{milestone}} Followers</h1>
    <p style="font-size: 14px; color: #666; margin: 0;">{{account_name}} now has {{current_count}} followers on LinkedIn.</p>
  </div>
  <p style="font-size: 12px; color: #999; text-align: center;">SDFM Group Limited · Transforming Kenyan Businesses</p>
</div>',
 false,
 ARRAY['account_name','milestone','current_count']),

('sm_engagement_spike', 'Engagement Spike Detected', 'team',
 'Sent when a post''s engagement or comment activity is unusually high (or a cluster of negative comments needs attention).',
 'Engagement Spike on a LinkedIn Post',
 '<div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #201E1D;">
  <div style="padding: 32px 0 24px; text-align: center;">
    <span style="font-size: 22px; font-weight: 700; color: #EC3013;">SDFM GROUP</span>
    <span style="font-size: 12px; display: block; letter-spacing: 0.15em; color: #201E1D;">LIMITED</span>
  </div>
  <div style="background: #F3F2F2; border-radius: 10px; padding: 32px; margin-bottom: 24px;">
    <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 8px;">Unusual activity on a post</h1>
    <div style="background: white; border-radius: 8px; padding: 20px; border-left: 4px solid #EC3013;">
      <p style="margin: 0 0 8px; font-size: 14px; color: #666;">{{post_caption_preview}}</p>
      <p style="margin: 0; font-size: 14px;"><strong>{{metric_name}}:</strong> {{metric_value}}</p>
    </div>
    <p style="font-size: 13px; color: #666; margin: 24px 0 0;">Check it out on the <a href="{{post_link}}" style="color: #EC3013; font-weight: 600;">Activity Inbox</a>.</p>
  </div>
  <p style="font-size: 12px; color: #999; text-align: center;">SDFM Group Limited · Transforming Kenyan Businesses</p>
</div>',
 false,
 ARRAY['post_caption_preview','metric_name','metric_value','post_link']),

('sm_weekly_digest', 'Weekly Performance Digest', 'team',
 'Weekly summary of LinkedIn performance, sent every Monday morning.',
 'LinkedIn Weekly Digest — {{week_range}}',
 '<div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #201E1D;">
  <div style="padding: 32px 0 24px; text-align: center;">
    <span style="font-size: 22px; font-weight: 700; color: #EC3013;">SDFM GROUP</span>
    <span style="font-size: 12px; display: block; letter-spacing: 0.15em; color: #201E1D;">LIMITED</span>
  </div>
  <div style="background: #F3F2F2; border-radius: 10px; padding: 32px; margin-bottom: 24px;">
    <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 8px;">Weekly Digest — {{week_range}}</h1>
    <div style="background: white; border-radius: 8px; padding: 20px;">
      <p style="margin: 0 0 8px; font-size: 14px;"><strong>Impressions:</strong> {{total_impressions}}</p>
      <p style="margin: 0 0 8px; font-size: 14px;"><strong>Engagement:</strong> {{total_engagement}}</p>
      <p style="margin: 0 0 8px; font-size: 14px;"><strong>Follower growth:</strong> {{follower_growth}}</p>
      <p style="margin: 0; font-size: 14px;"><strong>Top post:</strong> {{top_post_caption}}</p>
    </div>
    <p style="font-size: 13px; color: #666; margin: 24px 0 0;">Full breakdown on the <a href="{{dashboard_link}}" style="color: #EC3013; font-weight: 600;">Analytics Dashboard</a>.</p>
  </div>
  <p style="font-size: 12px; color: #999; text-align: center;">SDFM Group Limited · Transforming Kenyan Businesses</p>
</div>',
 false,
 ARRAY['week_range','total_impressions','total_engagement','follower_growth','top_post_caption','dashboard_link'])

on conflict (template_key) do nothing;
