-- ============================================================
-- Website analytics — booking journey reporting
--
-- Run AFTER migration-booking-flow-analytics.sql. Safe to re-run.
-- Replaces web_analytics_acquisition, web_analytics_behavior and
-- web_analytics_conversion (same signatures, so the app keeps working
-- whether or not this has been run; the new report sections simply stay
-- hidden until it has).
--
-- 1. A lead is counted once.
--    The reminder email sends people back to sdfmgroup.com/book in a new
--    tab, which is a new tracker session. Both sessions end up linked to
--    the same lead, so "Leads" (and the channel credited) was counted twice
--    and the second one showed up as "direct". Each lead is now credited to
--    the FIRST session that carried it.
--      -> acquisition, behavior and conversion all use the same join.
--
-- 2. The booking funnel counts fresh visits only.
--    A "return leg" is a session that opened the booking page after the
--    details step (reminder link, "answer the prep questions" link) without
--    entering details in that session. Return legs are reported separately
--    under follow_up.returns, not as extra visitors in the funnel.
--
-- 3. New keys on web_analytics_conversion:
--      contact_methods   book / WhatsApp / phone / email clicks (cta_click, click kind tel|mailto)
--      cta_placements    the same, per placement label (data-sdfm-label)
--      contact_reach     visits that used a CTA; how many went off-site and never booked
--      follow_up         details saved but not booked, reminders sent, booked after a reminder
--      after_booking     calendar adds, prep questions shown / skipped / answered
--      errors_by_stage   form_error grouped by stage (start, slot_taken, confirm, ...)
--      timing.median_minutes_to_book
--      journeys[].booked / minutes_to_book / prep_done / after_reminder
--    Removed: back_clicks (the new booking page has no Back button, so the
--    form_back event never fires).
--
-- Note on "reminded": send-booking-nudges also stamps nudge_sent_at on a lead
-- it skips because the same email had already booked, so "reminded" can be
-- slightly higher than the emails actually sent.
-- ============================================================

create or replace function public.web_analytics_acquisition(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_tz text default 'Africa/Nairobi'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from timestamptz := coalesce(p_from, '2000-01-01'::timestamptz);
  v_to timestamptz := coalesce(p_to, now() + interval '1 day');
  v_result jsonb;
begin
  if not public.wa_is_content_team() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  with s as (
    select
      ws.*,
      l.id as lid,
      (l.id is not null and l.classification in ('hot', 'warm') and not coalesce(l.is_disqualified, false)) as qualified
    from public.web_sessions ws
    left join public.leads l on l.id = ws.lead_id
      and ws.id = (select w2.id from public.web_sessions w2 where w2.lead_id = ws.lead_id order by w2.started_at, w2.id limit 1)
    where ws.started_at >= v_from and ws.started_at < v_to
  )
  select jsonb_build_object(
    'kpis', (
      select jsonb_build_object(
        'sessions', count(*),
        'visitors', count(distinct coalesce(visitor_id, id::text)),
        'returning_sessions', count(*) filter (where is_returning),
        'leads', count(lid),
        'qualified', count(*) filter (where qualified)
      ) from s
    ),
    'trend', coalesce((
      select jsonb_agg(t order by t.day)
      from (
        select to_char(started_at at time zone p_tz, 'YYYY-MM-DD') as day, count(*) as sessions, count(lid) as leads
        from s group by 1
      ) t
    ), '[]'::jsonb),
    'channels', coalesce((
      select jsonb_agg(c order by c.sessions desc)
      from (
        select channel, count(*) as sessions,
               count(distinct coalesce(visitor_id, id::text)) as visitors,
               count(lid) as leads,
               count(*) filter (where qualified) as qualified
        from s group by channel
      ) c
    ), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_agg(x order by x.sessions desc)
      from (
        select coalesce(source, '(direct)') as source, medium, channel, count(*) as sessions,
               count(lid) as leads, count(*) filter (where qualified) as qualified
        from s group by source, medium, channel
        order by count(*) desc limit 15
      ) x
    ), '[]'::jsonb),
    'campaigns', coalesce((
      select jsonb_agg(x order by x.sessions desc)
      from (
        select utm_campaign as campaign, max(utm_source) as source, count(*) as sessions,
               count(lid) as leads, count(*) filter (where qualified) as qualified
        from s where utm_campaign is not null
        group by utm_campaign
        order by count(*) desc limit 15
      ) x
    ), '[]'::jsonb),
    'referrers', coalesce((
      select jsonb_agg(x order by x.sessions desc)
      from (
        select referrer_domain as domain, channel, count(*) as sessions, count(lid) as leads
        from s where referrer_domain is not null
        group by referrer_domain, channel
        order by count(*) desc limit 10
      ) x
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.web_analytics_behavior(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_tz text default 'Africa/Nairobi'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from timestamptz := coalesce(p_from, '2000-01-01'::timestamptz);
  v_to timestamptz := coalesce(p_to, now() + interval '1 day');
  v_result jsonb;
begin
  if not public.wa_is_content_team() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  with ev as (
    select * from public.web_events where occurred_at >= v_from and occurred_at < v_to
  ),
  -- A session counts as "active" (not a bounce) if it did anything beyond
  -- loading a page: clicked, opened the intake form, downloaded, etc.
  active as (
    select distinct session_id from ev
    where type in ('click', 'cta_click', 'outbound', 'download', 'site_form_submit', 'form_view')
  ),
  s as (
    select ws.*,
           (ws.pageviews <= 1 and ws.engaged_ms < 10000 and not exists (select 1 from active a where a.session_id = ws.id)) as bounced,
           l.id as lid,
           (l.id is not null and l.classification in ('hot', 'warm') and not coalesce(l.is_disqualified, false)) as qualified
    from public.web_sessions ws
    left join public.leads l on l.id = ws.lead_id
      and ws.id = (select w2.id from public.web_sessions w2 where w2.lead_id = ws.lead_id order by w2.started_at, w2.id limit 1)
    where ws.started_at >= v_from and ws.started_at < v_to and ws.pageviews > 0
  )
  select jsonb_build_object(
    'kpis', jsonb_build_object(
      'pageviews', (select count(*) from ev where type = 'pageview'),
      'sessions', (select count(*) from s),
      'avg_engaged_seconds', (select coalesce(round(avg(engaged_ms) / 1000.0, 1), 0) from s),
      'pages_per_session', (select coalesce(round(avg(pageviews)::numeric, 2), 0) from s),
      'bounce_rate', (select case when count(*) > 0 then round(100.0 * count(*) filter (where bounced) / count(*), 1) else 0 end from s),
      'avg_scroll', (select coalesce(round(avg(max_scroll)), 0) from s)
    ),
    'trend', coalesce((
      select jsonb_agg(t order by t.day)
      from (
        select to_char(occurred_at at time zone p_tz, 'YYYY-MM-DD') as day, count(*) as pageviews
        from ev where type = 'pageview' group by 1
      ) t
    ), '[]'::jsonb),
    'top_pages', coalesce((
      select jsonb_agg(p order by p.views desc)
      from (
        select host, path,
               count(*) filter (where type = 'pageview') as views,
               count(distinct session_id) filter (where type = 'pageview') as sessions,
               round(coalesce(sum(case when type = 'page_leave' and props ->> 'engaged_ms' ~ '^\d{1,9}$'
                                       then (props ->> 'engaged_ms')::bigint end), 0) / 1000.0
                     / nullif(count(*) filter (where type = 'pageview'), 0), 1) as avg_engaged_seconds,
               round(avg(case when type = 'page_leave' and props ->> 'max_scroll' ~ '^\d{1,3}$'
                              then (props ->> 'max_scroll')::int end)) as avg_scroll
        from ev
        where type in ('pageview', 'page_leave') and path is not null
        group by host, path
        having count(*) filter (where type = 'pageview') > 0
        order by count(*) filter (where type = 'pageview') desc limit 20
      ) p
    ), '[]'::jsonb),
    'landing_pages', coalesce((
      select jsonb_agg(p order by p.sessions desc)
      from (
        select coalesce(landing_path, '/') as path, count(*) as sessions,
               round(100.0 * count(*) filter (where bounced) / count(*), 1) as bounce_rate,
               round(avg(engaged_ms) / 1000.0, 1) as avg_engaged_seconds,
               count(lid) as leads,
               count(*) filter (where qualified) as qualified
        from s group by landing_path
        order by count(*) desc limit 20
      ) p
    ), '[]'::jsonb),
    'clicks', coalesce((
      select jsonb_agg(c order by c.clicks desc)
      from (
        select type, coalesce(props ->> 'label', '(no label)') as label, max(props ->> 'href') as target,
               count(*) as clicks, count(distinct session_id) as sessions
        from ev
        where type in ('click', 'cta_click', 'outbound', 'download', 'site_form_submit')
        group by type, coalesce(props ->> 'label', '(no label)')
        order by count(*) desc limit 20
      ) c
    ), '[]'::jsonb),
    'devices', coalesce((select jsonb_agg(x order by x.sessions desc) from (
      select coalesce(device_type, 'unknown') as name, count(*) as sessions from s group by 1) x), '[]'::jsonb),
    'browsers', coalesce((select jsonb_agg(x order by x.sessions desc) from (
      select coalesce(browser, 'unknown') as name, count(*) as sessions from s group by 1 order by 2 desc limit 6) x), '[]'::jsonb),
    'systems', coalesce((select jsonb_agg(x order by x.sessions desc) from (
      select coalesce(os, 'unknown') as name, count(*) as sessions from s group by 1 order by 2 desc limit 6) x), '[]'::jsonb),
    'timezones', coalesce((select jsonb_agg(x order by x.sessions desc) from (
      select coalesce(timezone, 'unknown') as name, count(*) as sessions from s group by 1 order by 2 desc limit 8) x), '[]'::jsonb),
    'languages', coalesce((select jsonb_agg(x order by x.sessions desc) from (
      select coalesce(nullif(split_part(coalesce(language, ''), '-', 1), ''), 'unknown') as name, count(*) as sessions
      from s group by 1 order by 2 desc limit 6) x), '[]'::jsonb),
    'visitor_mix', (
      select jsonb_build_object(
        'new', count(*) filter (where not is_returning),
        'returning', count(*) filter (where is_returning),
        'consented', count(*) filter (where consented)
      ) from s
    )
  ) into v_result;

  return v_result;
end;
$$;


create or replace function public.web_analytics_conversion(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_tz text default 'Africa/Nairobi'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from timestamptz := coalesce(p_from, '2000-01-01'::timestamptz);
  v_to timestamptz := coalesce(p_to, now() + interval '1 day');
  v_result jsonb;
begin
  if not public.wa_is_content_team() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  with s as (
    select ws.*, l.id as lid, l.created_at as lead_created_at, l.classification, l.is_disqualified,
           l.total_score, l.source as lead_source, l.scheduled_date as lead_scheduled_date,
           l.qualification_completed_at as lead_prep_at,
           l.booked_at as lead_booked_at, l.nudge_sent_at as lead_nudge_at,
           (l.id is not null and l.classification in ('hot', 'warm') and not coalesce(l.is_disqualified, false)) as qualified
    from public.web_sessions ws
    left join public.leads l on l.id = ws.lead_id
      and ws.id = (select w2.id from public.web_sessions w2 where w2.lead_id = ws.lead_id order by w2.started_at, w2.id limit 1)
    where ws.started_at >= v_from and ws.started_at < v_to
  ),
  flags as (
    select e.session_id,
           bool_or(e.type = 'form_view') as f_view,
           bool_or(e.type = 'form_start') as f_start,
           bool_or(e.type = 'form_step_complete' and e.props ->> 'step' = '1') as f_s1,
           bool_or(e.type = 'form_slot_selected') as f_slot,
           bool_or(e.type = 'form_step_view' and e.props ->> 'step' = '3') as f_step3,
           bool_or(e.type = 'form_resume') as f_resume,
           bool_or(e.type = 'prep_view') as f_prep_view,
           bool_or(e.type = 'prep_skip') as f_prep_skip,
           bool_or(e.type = 'click' and e.props ->> 'label' = 'download_ics') as f_ics
    from public.web_events e
    join s on s.id = e.session_id
    where e.type in ('form_view', 'form_start', 'form_step_complete', 'form_slot_selected',
                     'form_step_view', 'form_resume', 'prep_view', 'prep_skip')
       or (e.type = 'click' and e.props ->> 'label' = 'download_ics')
    group by e.session_id
  ),
  -- Each step implies the ones before it, so the funnel can only narrow.
  -- Contact details saved, booked and prep answered come from the real leads row
  -- (s.lid), never a client-sent event: the tracker endpoint is public, so only
  -- the database can vouch for a lead.
  cs0 as (
    select s.*,
           (s.lid is not null and s.lead_scheduled_date is not null) as r_book,
           (s.lid is not null and s.lead_prep_at is not null) as r_prep,
           (coalesce(f.f_slot, false) or (s.lid is not null and s.lead_scheduled_date is not null)) as r_slot,
           (coalesce(f.f_s1, false) or coalesce(f.f_slot, false) or s.lid is not null) as r_s1,
           (coalesce(f.f_start, false) or coalesce(f.f_s1, false) or coalesce(f.f_slot, false) or s.lid is not null) as r_start,
           (coalesce(f.f_view, false) or coalesce(f.f_start, false) or coalesce(f.f_s1, false) or coalesce(f.f_slot, false) or s.lid is not null) as r_view,
           coalesce(f.f_prep_view, false) as f_prep_view,
           coalesce(f.f_prep_skip, false) as f_prep_skip,
           coalesce(f.f_ics, false) as f_ics,
           -- Came back to an existing booking (reminder link, prep link) without
           -- entering contact details in this session.
           ((coalesce(f.f_resume, false) or coalesce(f.f_step3, false)) and not coalesce(f.f_s1, false)) as is_return
    from s left join flags f on f.session_id = s.id
  ),
  -- Fresh visits. A return leg whose lead is credited to an earlier session is
  -- not a new visitor; a return leg that is the only session for its lead stays.
  cs as (
    select * from cs0 where not (is_return and lid is null)
  ),
  -- Which way a visitor chose to get in touch. Site buttons carry
  -- data-sdfm-cta, so they arrive as cta_click with the link target in href;
  -- tel: and mailto: links arrive as click with kind = 'tel' / 'mailto'.
  cta as (
    select e.session_id, coalesce(e.props ->> 'label', '(no label)') as label,
           case
             when e.type = 'click' and e.props ->> 'kind' = 'tel' then 'phone'
             when e.type = 'click' and e.props ->> 'kind' = 'mailto' then 'email'
             when e.type = 'cta_click' and e.props ->> 'href' like 'wa.me/%' then 'whatsapp'
             when e.type = 'cta_click' and e.props ->> 'href' like '%/book' then 'book'
           end as method
    from public.web_events e
    join cs on cs.id = e.session_id
    where e.type in ('click', 'cta_click')
  ),
  cta_m as (
    select * from cta where method is not null
  )
  select jsonb_build_object(
    'funnel', (
      select jsonb_build_object(
        'sessions', count(*),
        'viewed_form', count(*) filter (where r_view),
        'started_form', count(*) filter (where r_start),
        'contact_done', count(*) filter (where r_s1),
        'picked_slot', count(*) filter (where r_slot),
        'submitted', count(*) filter (where r_book),
        'prep_done', count(*) filter (where r_prep),
        'qualified', count(*) filter (where qualified)
      ) from cs
    ),
    -- Event-level, so it includes return legs: someone who comes back from a
    -- reminder email does reach "Pick a time" a second time.
    'steps', coalesce((
      select jsonb_agg(x order by x.step)
      from (
        select e.props ->> 'step' as step,
               count(distinct e.session_id) filter (where e.type = 'form_step_view') as views,
               count(distinct e.session_id) filter (where e.type = 'form_step_complete') as completes,
               round(avg(case when e.type = 'form_step_complete' and e.props ->> 'duration_ms' ~ '^\d{1,9}$'
                              then (e.props ->> 'duration_ms')::bigint end) / 1000.0, 1) as avg_seconds
        from public.web_events e
        join s on s.id = e.session_id
        where e.type in ('form_step_view', 'form_step_complete') and e.props ->> 'step' ~ '^[1-3]$'
        group by e.props ->> 'step'
      ) x
    ), '[]'::jsonb),
    'errors', (
      select count(*) from public.web_events e join s on s.id = e.session_id where e.type = 'form_error'
    ),
    'errors_by_stage', coalesce((
      select jsonb_agg(x order by x.events desc)
      from (
        select coalesce(nullif(e.props ->> 'stage', ''), 'unknown') as stage,
               count(*) as events, count(distinct e.session_id) as sessions
        from public.web_events e
        join s on s.id = e.session_id
        where e.type = 'form_error'
        group by 1
      ) x
    ), '[]'::jsonb),
    -- Last answer per session per question, so changing your mind counts once.
    -- Over all sessions: most prep answers arrive via the emailed link.
    'answers', coalesce((
      select jsonb_agg(x order by x.q, x.sessions desc)
      from (
        select q, value, count(*) as sessions
        from (
          select distinct on (e.session_id, e.props ->> 'q')
                 e.props ->> 'q' as q, e.props ->> 'value' as value
          from public.web_events e
          join s on s.id = e.session_id
          where e.type = 'form_answer' and e.props ->> 'q' ~ '^q[1-5]$' and e.props ->> 'value' is not null
          order by e.session_id, e.props ->> 'q', e.occurred_at desc, e.id desc
        ) a
        group by q, value
      ) x
    ), '[]'::jsonb),
    'contact_methods', coalesce((
      select jsonb_agg(x order by x.sessions desc)
      from (
        select m.method, count(*) as clicks, count(distinct m.session_id) as sessions,
               count(distinct m.session_id) filter (where cs.r_book) as booked
        from cta_m m join cs on cs.id = m.session_id
        group by m.method
      ) x
    ), '[]'::jsonb),
    'cta_placements', coalesce((
      select jsonb_agg(x order by x.clicks desc)
      from (
        select m.label, m.method, count(*) as clicks, count(distinct m.session_id) as sessions,
               count(distinct m.session_id) filter (where cs.lid is not null) as leads,
               count(distinct m.session_id) filter (where cs.r_book) as booked
        from cta_m m join cs on cs.id = m.session_id
        group by m.label, m.method
        order by count(*) desc limit 25
      ) x
    ), '[]'::jsonb),
    'contact_reach', (
      select jsonb_build_object(
        'any', count(distinct m.session_id),
        'offsite', count(distinct m.session_id) filter (where m.method in ('whatsapp', 'phone', 'email')),
        'offsite_not_booked', count(distinct m.session_id) filter (where m.method in ('whatsapp', 'phone', 'email') and not cs.r_book)
      ) from cta_m m join cs on cs.id = m.session_id
    ),
    'follow_up', (
      select jsonb_build_object(
        'details_saved', count(*) filter (where lid is not null),
        'booked', count(*) filter (where r_book),
        'waiting', count(*) filter (where lid is not null and not r_book),
        'reminded', count(*) filter (where lid is not null and lead_nudge_at is not null),
        'recovered', count(*) filter (where lid is not null and lead_nudge_at is not null
                                       and lead_booked_at is not null and lead_booked_at > lead_nudge_at),
        'returns', (select count(*) from cs0 where is_return)
      ) from cs
    ),
    'after_booking', (
      select jsonb_build_object(
        'booked', count(*) filter (where r_book),
        'calendar_added', count(*) filter (where f_ics),
        'prep_shown', count(*) filter (where f_prep_view),
        'prep_skipped', count(*) filter (where f_prep_skip),
        'prep_answered', count(*) filter (where r_prep),
        'avg_questions', (
          select coalesce(round(avg((e.props ->> 'answered')::int)::numeric, 1), 0)
          from public.web_events e join cs on cs.id = e.session_id
          where e.type = 'prep_complete' and e.props ->> 'answered' ~ '^[1-5]$'
        )
      ) from cs
    ),
    'by_channel', coalesce((
      select jsonb_agg(x order by x.sessions desc)
      from (
        select channel, count(*) as sessions,
               count(*) filter (where r_view) as form_views,
               count(*) filter (where r_start) as form_starts,
               count(lid) as leads,
               count(*) filter (where r_book) as booked,
               count(*) filter (where qualified) as qualified
        from cs group by channel
      ) x
    ), '[]'::jsonb),
    'by_source', coalesce((
      select jsonb_agg(x order by x.sessions desc)
      from (
        select coalesce(source, '(direct)') as source, medium, count(*) as sessions,
               count(*) filter (where r_view) as form_views,
               count(lid) as leads,
               count(*) filter (where r_book) as booked,
               count(*) filter (where qualified) as qualified
        from cs group by source, medium
        order by count(*) desc limit 15
      ) x
    ), '[]'::jsonb),
    'by_campaign', coalesce((
      select jsonb_agg(x order by x.sessions desc)
      from (
        select utm_campaign as campaign, count(*) as sessions,
               count(*) filter (where r_view) as form_views,
               count(lid) as leads,
               count(*) filter (where r_book) as booked,
               count(*) filter (where qualified) as qualified
        from cs where utm_campaign is not null
        group by utm_campaign
        order by count(*) desc limit 15
      ) x
    ), '[]'::jsonb),
    'by_landing', coalesce((
      select jsonb_agg(x order by x.leads desc, x.sessions desc)
      from (
        select coalesce(landing_path, '/') as path, count(*) as sessions,
               count(*) filter (where r_view) as form_views,
               count(lid) as leads,
               count(*) filter (where r_book) as booked,
               count(*) filter (where qualified) as qualified
        from cs group by landing_path
        order by count(lid) desc, count(*) desc limit 15
      ) x
    ), '[]'::jsonb),
    'journeys', coalesce((
      select jsonb_agg(x order by x.at desc)
      from (
        select to_char(lead_created_at at time zone p_tz, 'YYYY-MM-DD HH24:MI') as at,
               classification, is_disqualified, total_score, qualified,
               r_book as booked, r_prep as prep_done,
               (lead_nudge_at is not null and lead_booked_at is not null and lead_booked_at > lead_nudge_at) as after_reminder,
               channel, coalesce(source, '(direct)') as source, lead_source,
               coalesce(landing_path, '/') as landing_path, utm_campaign as campaign,
               pageviews, device_type,
               round(extract(epoch from (lead_created_at - started_at)) / 60.0)::int as minutes_to_convert,
               case when lead_booked_at is not null and lead_booked_at >= started_at
                    then round(extract(epoch from (lead_booked_at - started_at)) / 60.0)::int end as minutes_to_book
        from cs where lid is not null
        order by lead_created_at desc limit 15
      ) x
    ), '[]'::jsonb),
    'timing', (
      select jsonb_build_object(
        'avg_minutes_to_convert', coalesce(round(avg(extract(epoch from (lead_created_at - started_at)) / 60.0)::numeric, 1), 0),
        'avg_pages_before_convert', coalesce(round(avg(pageviews)::numeric, 1), 0),
        -- Median, not mean: a lead who books the next day after a reminder
        -- would otherwise drag the figure up for everyone.
        'median_minutes_to_book', (
          select round((percentile_cont(0.5) within group (order by extract(epoch from (lead_booked_at - started_at)) / 60.0))::numeric, 0)
          from cs where lid is not null and lead_booked_at is not null and lead_booked_at >= started_at
        )
      ) from cs where lid is not null
    ),
    -- Sanity check: how many leads in the period can be tied to a tracked
    -- session (tracker not installed yet / script blocked => untracked).
    'coverage', (
      select jsonb_build_object(
        'leads_total', count(*),
        'leads_tracked', count(*) filter (where exists (select 1 from public.web_sessions w where w.lead_id = l.id)),
        'qualified_total', count(*) filter (where l.classification in ('hot', 'warm') and not coalesce(l.is_disqualified, false))
      )
      from public.leads l where l.created_at >= v_from and l.created_at < v_to
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.web_analytics_acquisition(timestamptz, timestamptz, text) from public, anon;
revoke all on function public.web_analytics_behavior(timestamptz, timestamptz, text) from public, anon;
revoke all on function public.web_analytics_conversion(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.web_analytics_acquisition(timestamptz, timestamptz, text) to authenticated;
grant execute on function public.web_analytics_behavior(timestamptz, timestamptz, text) to authenticated;
grant execute on function public.web_analytics_conversion(timestamptz, timestamptz, text) to authenticated;
