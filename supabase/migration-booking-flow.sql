-- ============================================================
-- Booking flow v2 — additive changes (safe to re-run)
--
-- Moves the public booking form from this app (/intake) to
-- sdfmgroup.com/book and changes the journey to:
--   contact details  ->  pick a time  ->  confirmed  ->  optional prep questions
--
--   * A lead row is created as soon as the contact step is submitted
--     (current_stage = 'Incomplete'), so abandoned bookings are recoverable.
--   * Everyone who picks a time is confirmed ("book all, score later").
--     The five qualification questions are asked AFTER booking and only
--     score the lead (hot / warm / cold) for the team's own prioritisation.
--   * The browser no longer talks to the leads / booked_slots tables at all:
--     booking-info, booking-start, booking-confirm and booking-prep Edge
--     Functions do it server-side (service role).
--
-- Run order (see README "Booking flow"):
--   1. this file
--   2. migration-booking-flow-analytics.sql
--   3. deploy the booking-* Edge Functions, then the website, then this app
--   4. migration-booking-nudges-cron.sql
--   5. migration-booking-lockdown.sql   (LAST — removes the old public access)
-- ============================================================


-- 1. Leads: new classification value + booking columns ----------------------

-- 'unscored' = booked (or started) but hasn't answered the prep questions yet.
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.leads'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%classification%'
  loop
    execute format('alter table public.leads drop constraint %I', c);
  end loop;
end $$;

alter table public.leads
  add constraint leads_classification_check
  check (classification in ('hot', 'warm', 'cold', 'unscored'));

-- What the visitor typed in "What would you like to fix first?" (optional).
alter table public.leads add column if not exists challenge_notes text;

-- Secret handed to the visitor's browser (and their emails). Together with the
-- lead id it proves "this is the person who created this lead" so they can
-- finish booking or answer the prep questions without an account.
alter table public.leads add column if not exists booking_token uuid not null default gen_random_uuid();

-- When the visitor confirmed a time slot.
alter table public.leads add column if not exists booked_at timestamptz;

-- When the prep (qualification) questions were answered. Null = not yet.
alter table public.leads add column if not exists qualification_completed_at timestamptz;

-- When the "finish booking your call" email went out for an Incomplete lead.
alter table public.leads add column if not exists nudge_sent_at timestamptz;

create index if not exists leads_incomplete_idx
  on public.leads (created_at)
  where current_stage = 'Incomplete' and nudge_sent_at is null;

create index if not exists leads_email_lower_idx on public.leads (lower(email));


-- 2. Abuse protection for the public booking endpoints ----------------------
-- One row per accepted request, keyed by a salted hash of the caller's IP
-- (never the IP itself). Only the Edge Functions (service role) touch it.

create table if not exists public.booking_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  action text not null,
  created_at timestamptz not null default now()
);

create index if not exists booking_attempts_lookup_idx
  on public.booking_attempts (ip_hash, action, created_at desc);

alter table public.booking_attempts enable row level security;
-- Deliberately no policies: anon/authenticated cannot read or write it.

create or replace function public.purge_booking_attempts()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.booking_attempts where created_at < now() - interval '2 days';
$$;

revoke all on function public.purge_booking_attempts() from public, anon, authenticated;


-- 3. Settings ----------------------------------------------------------------

-- The calls are 30 minutes (previously defaulted to 60 in the form).
insert into public.system_settings (key, value) values ('booking_duration_minutes', '30')
on conflict (key) do update set value = excluded.value;

-- The Google Meet room shown on the confirmation page and in emails.
-- Set it in Settings once; an empty value means "we'll send the link".
insert into public.system_settings (key, value) values ('meeting_link', '')
on conflict (key) do nothing;

-- WhatsApp Business number shown to visitors (digits only, country code first).
insert into public.system_settings (key, value) values ('whatsapp_number', '254757230579')
on conflict (key) do nothing;


-- 4. Email templates ---------------------------------------------------------
-- New keys, so any customised existing template (call_confirmed, ...) is left
-- exactly as it is. notify-lead prefers booking_confirmed and falls back to
-- call_confirmed if it is missing or switched off.
--
-- Extra variables available to these two:
--   {{meeting_details}}  HTML block with the Meet link (or "we'll send it")
--   {{calendar_link}}    "Add to Google Calendar" URL
--   {{prep_link}}        page where they can answer the prep questions
--   {{resume_link}}      page where they can pick a time
--   {{whatsapp_link}}    wa.me link to the company WhatsApp
--   {{duration_minutes}}

insert into public.email_templates
  (template_key, name, recipient_type, description, subject, body_html, is_active, available_variables)
values
('booking_confirmed', 'Discovery Call Confirmed (new booking flow)', 'client',
 'Sent to everyone who books a discovery call on sdfmgroup.com/book. Includes the meeting link, add-to-calendar and the optional prep questions.',
 'You''re booked: your discovery call on {{scheduled_day}} at {{scheduled_time}}',
 '<div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #201E1D;">
  <div style="padding: 32px 0 24px; text-align: center;">
    <span style="font-size: 22px; font-weight: 700; color: #EC3013;">SDFM GROUP</span>
    <span style="font-size: 12px; display: block; letter-spacing: 0.15em; color: #201E1D;">LIMITED</span>
  </div>
  <div style="background: #F3F2F2; border-radius: 10px; padding: 32px; margin-bottom: 24px;">
    <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 8px;">You''re booked, {{full_name}}</h1>
    <p style="font-size: 14px; color: #666; margin: 0 0 24px; line-height: 1.6;">Your {{duration_minutes}}-minute discovery call is confirmed.</p>
    <div style="background: white; border-radius: 8px; padding: 20px; border-left: 4px solid #EC3013;">
      <p style="margin: 0; font-size: 14px;"><strong>Date:</strong> {{scheduled_day}}</p>
      <p style="margin: 8px 0 0; font-size: 14px;"><strong>Time:</strong> {{scheduled_time}} ({{timezone}})</p>
      {{meeting_details}}
    </div>
    <p style="margin: 20px 0 0;"><a href="{{calendar_link}}" style="font-size: 14px; color: #C9260C; font-weight: 700;">Add to Google Calendar</a></p>
    <p style="font-size: 14px; color: #666; margin: 24px 0 0; line-height: 1.6;"><strong>What happens on the call:</strong> we ask about how your team works today, find where AI would save the most time or money, and tell you honestly whether we can help. You don''t need to prepare anything.</p>
    <p style="font-size: 14px; color: #666; margin: 16px 0 0; line-height: 1.6;">Want to make the call more useful? <a href="{{prep_link}}" style="color: #C9260C; font-weight: 700;">Answer 5 quick questions (about 60 seconds)</a> so we can come prepared.</p>
    <p style="font-size: 14px; color: #666; margin: 16px 0 0; line-height: 1.6;">Need to change the time or have a question? Reply to this email or <a href="{{whatsapp_link}}" style="color: #C9260C; font-weight: 700;">message us on WhatsApp</a>.</p>
  </div>
  <p style="font-size: 12px; color: #999; text-align: center;">SDFM Group Limited · Transforming Kenyan Businesses</p>
</div>',
 true,
 ARRAY['full_name','company_name','email','phone','scheduled_day','scheduled_time','timezone','duration_minutes','meeting_details','calendar_link','prep_link','whatsapp_link']),

('booking_nudge_client', 'Finish Booking Your Call (reminder)', 'client',
 'Sent about 30 minutes after someone enters their details on sdfmgroup.com/book but does not pick a time. Sent once.',
 '{{full_name}}, your free AI assessment call isn''t booked yet',
 '<div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #201E1D;">
  <div style="padding: 32px 0 24px; text-align: center;">
    <span style="font-size: 22px; font-weight: 700; color: #EC3013;">SDFM GROUP</span>
    <span style="font-size: 12px; display: block; letter-spacing: 0.15em; color: #201E1D;">LIMITED</span>
  </div>
  <div style="background: #F3F2F2; border-radius: 10px; padding: 32px; margin-bottom: 24px;">
    <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 8px;">Pick a time that suits you</h1>
    <p style="font-size: 14px; color: #666; line-height: 1.6; margin: 0 0 16px;">Hi {{full_name}}, you started booking a free AI Gap Assessment call for {{company_name}} but didn''t choose a time. Your details are saved, so it takes one click:</p>
    <p style="margin: 0 0 20px;"><a href="{{resume_link}}" style="display: inline-block; background: #D82A10; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 700; padding: 12px 24px; border-radius: 6px;">Choose a time</a></p>
    <p style="font-size: 14px; color: #666; line-height: 1.6; margin: 0;">The call is {{duration_minutes}} minutes on Google Meet, free, with no obligation. Prefer to talk it through first? <a href="{{whatsapp_link}}" style="color: #C9260C; font-weight: 700;">Message us on WhatsApp</a>.</p>
  </div>
  <p style="font-size: 12px; color: #999; text-align: center;">SDFM Group Limited · Transforming Kenyan Businesses</p>
</div>',
 true,
 ARRAY['full_name','company_name','email','phone','duration_minutes','resume_link','whatsapp_link'])
on conflict (template_key) do nothing;
