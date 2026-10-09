-- ============================================================
-- Booking flow v2 — website analytics funnel
--
-- Run AFTER migration-booking-flow.sql (needs the new leads columns).
-- Safe to re-run. Replaces four functions from migration-website-analytics.sql
-- (generated from it, with only the changes described here):
--
--   track_web_batch
--       A session is also tied to its lead when the booking page reports
--       'form_lead_captured' (contact details saved), not only on
--       'form_submit' (call booked) — so people who never pick a time still
--       count as leads with a known source.
--
--   web_analytics_acquisition / _behavior / _conversion
--       "Qualified" now means a Hot or Warm lead (classification in
--       ('hot','warm')). Leads that are still 'unscored' (booked, haven't
--       answered the prep questions) are no longer counted as qualified just
--       because they are not 'cold'.
--
--   web_analytics_conversion — the intake funnel is now:
--       sessions -> opened the form -> started -> contact details saved
--       -> picked a time -> booked ('submitted') -> answered prep questions
--       -> qualified (hot/warm)
--     'contact_done', 'booked' and 'prep_done' come from the leads table, so
--     the public tracker endpoint cannot inflate them.
-- ============================================================

create or replace function public.track_web_batch(payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_headers json;
  v_ua text;
  s jsonb;
  v_events jsonb;
  v_sid uuid;
  v_visitor text;
  v_consented boolean;
  v_ref text;
  v_ref_domain text;
  v_cls record;
  v_existing int;
  v_n int := 0;
  v_pv int := 0;
  v_engaged bigint := 0;
  v_scroll int := 0;
  v_lead_txt text;
  v_lead uuid;
begin
  -- Crawlers and link-preview fetchers are not visitors.
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    v_headers := null;
  end;
  v_ua := coalesce(v_headers ->> 'user-agent', '');
  if v_ua ~* '(bot|crawler|spider|slurp|headless|lighthouse|pagespeed|facebookexternalhit)' then
    return;
  end if;

  if payload is null or jsonb_typeof(payload) <> 'object' then return; end if;
  s := payload -> 'session';
  if s is null or jsonb_typeof(s) <> 'object' then return; end if;

  begin
    v_sid := (s ->> 'id')::uuid;
  exception when others then
    return;
  end;
  if v_sid is null then return; end if;

  v_events := coalesce(payload -> 'events', '[]'::jsonb);
  if jsonb_typeof(v_events) <> 'array' then v_events := '[]'::jsonb; end if;
  if jsonb_array_length(v_events) > 50 then
    select coalesce(jsonb_agg(e), '[]'::jsonb) into v_events
    from (select e from jsonb_array_elements(v_events) e limit 50) t;
  end if;

  -- A single session never needs more than a few thousand events.
  select event_count into v_existing from public.web_sessions where id = v_sid;
  if v_existing is not null and v_existing >= 3000 then return; end if;

  v_consented := coalesce((s ->> 'consented') = 'true', false);
  v_visitor := case
    when v_consented and (s ->> 'visitor_id') ~ '^[0-9a-f-]{36}$' then s ->> 'visitor_id'
    else null
  end;

  v_ref := left(nullif(s ->> 'referrer', ''), 300);
  v_ref_domain := left(lower(substring(v_ref from '^https?://([^/:?#]+)')), 120);

  select * into v_cls
  from public.wa_classify_traffic(left(s ->> 'utm_source', 100), left(s ->> 'utm_medium', 100), v_ref_domain);

  insert into public.web_sessions (
    id, visitor_id, consented, is_returning,
    host, landing_path, referrer, referrer_domain,
    utm_source, utm_medium, utm_campaign, utm_term, utm_content,
    source, medium, channel,
    device_type, browser, os, language, timezone, viewport_w
  ) values (
    v_sid, v_visitor, v_consented and v_visitor is not null,
    coalesce((s ->> 'is_returning') = 'true', false) and v_visitor is not null,
    left(s ->> 'host', 120), left(s ->> 'landing_path', 300), v_ref, v_ref_domain,
    lower(left(nullif(s ->> 'utm_source', ''), 100)), lower(left(nullif(s ->> 'utm_medium', ''), 100)),
    lower(left(nullif(s ->> 'utm_campaign', ''), 150)), lower(left(nullif(s ->> 'utm_term', ''), 150)),
    lower(left(nullif(s ->> 'utm_content', ''), 150)),
    v_cls.source, v_cls.medium, v_cls.channel,
    left(s ->> 'device_type', 20), left(s ->> 'browser', 40), left(s ->> 'os', 40),
    left(s ->> 'language', 20), left(s ->> 'timezone', 60),
    case when s ->> 'viewport_w' ~ '^\d{2,5}$' then (s ->> 'viewport_w')::int end
  )
  on conflict (id) do update set
    last_seen_at = now(),
    -- Consent can be granted mid-session: upgrade, never downgrade.
    visitor_id = coalesce(public.web_sessions.visitor_id, excluded.visitor_id),
    consented = public.web_sessions.consented or excluded.consented,
    is_returning = public.web_sessions.is_returning or excluded.is_returning;

  with incoming as (
    select
      left(e ->> 'eid', 40) as eid,
      lower(left(e ->> 'type', 40)) as type,
      left(e ->> 'host', 120) as host,
      left(e ->> 'path', 300) as path,
      left(e ->> 'title', 160) as title,
      case when e ->> 'age_ms' ~ '^\d{1,9}$' then least((e ->> 'age_ms')::bigint, 86400000) else 0 end as age_ms,
      case
        when jsonb_typeof(e -> 'props') = 'object' and length((e -> 'props')::text) <= 2000 then e -> 'props'
        else '{}'::jsonb
      end as props
    from jsonb_array_elements(v_events) e
    where jsonb_typeof(e) = 'object'
  ),
  ins as (
    insert into public.web_events (session_id, eid, occurred_at, type, host, path, title, props)
    select v_sid, eid, now() - (age_ms::double precision / 1000) * interval '1 second', type, host, path, title, props
    from incoming
    where coalesce(eid, '') <> '' and type ~ '^[a-z][a-z0-9_]{0,39}$'
    on conflict (session_id, eid) do nothing
    returning type, props
  )
  select
    count(*)::int,
    (count(*) filter (where type = 'pageview'))::int,
    coalesce(sum(case
      when type = 'page_leave' and props ->> 'engaged_ms' ~ '^\d{1,9}$'
        then least((props ->> 'engaged_ms')::bigint, 3600000)
      else 0 end), 0),
    coalesce(max(case
      when type = 'page_leave' and props ->> 'max_scroll' ~ '^\d{1,3}$'
        then least((props ->> 'max_scroll')::int, 100)
      end), 0),
    (array_agg(props ->> 'lead_id') filter (where type in ('form_submit', 'form_lead_captured') and props ->> 'lead_id' is not null))[1]
  into v_n, v_pv, v_engaged, v_scroll, v_lead_txt
  from ins;

  -- Only link a lead that really exists (the form submits before reporting).
  if v_lead_txt ~ '^[0-9a-f-]{36}$' then
    select id into v_lead from public.leads where id = v_lead_txt::uuid;
  end if;

  update public.web_sessions set
    pageviews = pageviews + coalesce(v_pv, 0),
    event_count = event_count + coalesce(v_n, 0),
    engaged_ms = engaged_ms + coalesce(v_engaged, 0),
    max_scroll = greatest(max_scroll, coalesce(v_scroll, 0)),
    lead_id = coalesce(lead_id, v_lead)
  where id = v_sid;
end;
$$;

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
           (l.id is not null and l.classification in ('hot', 'warm') and not coalesce(l.is_disqualified, false)) as qualified
    from public.web_sessions ws
    left join public.leads l on l.id = ws.lead_id
    where ws.started_at >= v_from and ws.started_at < v_to
  ),
  flags as (
    select e.session_id,
           bool_or(e.type = 'form_view') as f_view,
           bool_or(e.type = 'form_start') as f_start,
           bool_or(e.type = 'form_step_complete' and e.props ->> 'step' = '1') as f_s1,
           bool_or(e.type = 'form_step_complete' and e.props ->> 'step' = '2') as f_s2,
           bool_or(e.type = 'form_slot_selected') as f_slot
    from public.web_events e
    join s on s.id = e.session_id
    where e.type in ('form_view', 'form_start', 'form_step_complete', 'form_slot_selected')
    group by e.session_id
  ),
  -- Each step implies the ones before it, so the funnel can only narrow.
  -- Contact details saved, booked and prep answered come from the real leads row
  -- (s.lid), never a client-sent event: the tracker endpoint is public, so only
  -- the database can vouch for a lead.
  cs as (
    select s.*,
           (s.lid is not null and s.lead_scheduled_date is not null) as r_book,
           (s.lid is not null and s.lead_prep_at is not null) as r_prep,
           (coalesce(f.f_slot, false) or (s.lid is not null and s.lead_scheduled_date is not null)) as r_slot,
           (coalesce(f.f_s1, false) or coalesce(f.f_slot, false) or s.lid is not null) as r_s1,
           (coalesce(f.f_start, false) or coalesce(f.f_s1, false) or coalesce(f.f_slot, false) or s.lid is not null) as r_start,
           (coalesce(f.f_view, false) or coalesce(f.f_start, false) or coalesce(f.f_s1, false) or coalesce(f.f_slot, false) or s.lid is not null) as r_view
    from s left join flags f on f.session_id = s.id
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
    'back_clicks', (
      select count(*) from public.web_events e join s on s.id = e.session_id where e.type = 'form_back'
    ),
    'errors', (
      select count(*) from public.web_events e join s on s.id = e.session_id where e.type = 'form_error'
    ),
    -- Last answer per session per question, so changing your mind counts once.
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
    'by_channel', coalesce((
      select jsonb_agg(x order by x.sessions desc)
      from (
        select channel, count(*) as sessions,
               count(*) filter (where r_view) as form_views,
               count(*) filter (where r_start) as form_starts,
               count(lid) as leads,
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
               channel, coalesce(source, '(direct)') as source, lead_source,
               coalesce(landing_path, '/') as landing_path, utm_campaign as campaign,
               pageviews, device_type,
               round(extract(epoch from (lead_created_at - started_at)) / 60.0)::int as minutes_to_convert
        from cs where lid is not null
        order by lead_created_at desc limit 15
      ) x
    ), '[]'::jsonb),
    'timing', (
      select jsonb_build_object(
        'avg_minutes_to_convert', coalesce(round(avg(extract(epoch from (lead_created_at - started_at)) / 60.0)::numeric, 1), 0),
        'avg_pages_before_convert', coalesce(round(avg(pageviews)::numeric, 1), 0)
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

revoke all on function public.track_web_batch(jsonb) from public;
grant execute on function public.track_web_batch(jsonb) to anon, authenticated;
revoke all on function public.web_analytics_acquisition(timestamptz, timestamptz, text) from public, anon;
revoke all on function public.web_analytics_behavior(timestamptz, timestamptz, text) from public, anon;
revoke all on function public.web_analytics_conversion(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.web_analytics_acquisition(timestamptz, timestamptz, text) to authenticated;
grant execute on function public.web_analytics_behavior(timestamptz, timestamptz, text) to authenticated;
grant execute on function public.web_analytics_conversion(timestamptz, timestamptz, text) to authenticated;
