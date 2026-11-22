-- ============================================================
-- Website Analytics v2 — one filterable report for the redesigned page
--
-- Run AFTER migration-website-analytics.sql, migration-booking-flow-analytics.sql,
-- migration-website-analytics-booking-journey.sql and migration-permissions-enforcement.sql.
-- Safe to re-run. Adds functions only; no tables or data are changed.
--
--   web_analytics_report(from, to, tz, filters, interval, compact)
--       Everything the Overview and Goals tabs show, for one period, with any
--       combination of filters applied (click a row in the app to add one):
--         channel, source, referrer, campaign, entry, exit, page, device,
--         browser, os, country, language, hostname, goal
--       kpis        visitors, visits, pageviews, views/visit, bounce rate, visit
--                   duration, conversions (visits that completed a goal), leads
--       series      the same per hour / day / week / month (team time zone)
--       channels, sources, referrers, campaigns, pages, entry_pages, exit_pages,
--       devices, browsers, systems, countries, languages, hostnames, events
--       goals       per goal: visits that completed it and total completions
--       funnels     scoper, contact-form and custom-build funnels (visits reaching
--                   each step; a later step implies the earlier ones)
--       live        visits active in the last 5 minutes (ignores the period)
--     compact = true returns only kpis, series, goals and funnels: used for the
--     comparison period.
--
--   seo_report(from, to, filters)
--       Search Console for the Search tab, filterable by query and page:
--       totals, daily, queries, pages (joined to our own organic visits and
--       conversions), opportunities ("striking distance" queries), countries,
--       devices and sync status.
--
-- Older functions (web_analytics_acquisition / _behavior / _conversion,
-- seo_overview) are left in place: the dashboard and the contact-route
-- detail on the Goals tab still use web_analytics_conversion.
--
-- Access: wa_is_content_team() = has_module_access('website_analytics')
-- (Settings → Permissions), re-checked inside each SECURITY DEFINER function.
-- ============================================================


-- 1. Helpers -------------------------------------------------------------------

-- One spelling per page: /custom-builds.html, /custom-builds/ and
-- /custom-builds are the same page on Netlify's pretty URLs.
create or replace function public.wa_norm_path(p text)
returns text
language sql
immutable
as $$
  select case
    when p is null or p = '' then null
    else coalesce(nullif(
      regexp_replace(
        regexp_replace(
          regexp_replace(split_part(split_part(p, '?', 1), '#', 1), '/index(\.html?)?$', '/'),
          '\.html?$', ''),
        '(.)/+$', '\1'),
      ''), '/')
  end
$$;

-- The tracker stores no IP address, so the country comes from the browser's
-- time zone (ISO 3166 alpha-2). Unknown zones return null.
create or replace function public.wa_tz_country(p_tz text)
returns text
language sql
immutable
as $$
  select v.c from (values
    ('Africa/Nairobi','KE'),('Africa/Kampala','UG'),('Africa/Dar_es_Salaam','TZ'),('Africa/Kigali','RW'),
    ('Africa/Addis_Ababa','ET'),('Africa/Mogadishu','SO'),('Africa/Juba','SS'),('Africa/Khartoum','SD'),
    ('Africa/Bujumbura','BI'),('Africa/Djibouti','DJ'),('Africa/Asmara','ER'),('Africa/Lagos','NG'),
    ('Africa/Accra','GH'),('Africa/Abidjan','CI'),('Africa/Dakar','SN'),('Africa/Johannesburg','ZA'),
    ('Africa/Harare','ZW'),('Africa/Lusaka','ZM'),('Africa/Maputo','MZ'),('Africa/Blantyre','MW'),
    ('Africa/Gaborone','BW'),('Africa/Windhoek','NA'),('Africa/Cairo','EG'),('Africa/Casablanca','MA'),
    ('Africa/Algiers','DZ'),('Africa/Tunis','TN'),('Africa/Kinshasa','CD'),('Africa/Lubumbashi','CD'),
    ('Africa/Luanda','AO'),('Africa/Douala','CM'),('Indian/Mauritius','MU'),('Indian/Antananarivo','MG'),
    ('Europe/London','GB'),('Europe/Dublin','IE'),('Europe/Paris','FR'),('Europe/Berlin','DE'),
    ('Europe/Amsterdam','NL'),('Europe/Brussels','BE'),('Europe/Zurich','CH'),('Europe/Vienna','AT'),
    ('Europe/Madrid','ES'),('Europe/Lisbon','PT'),('Europe/Rome','IT'),('Europe/Stockholm','SE'),
    ('Europe/Oslo','NO'),('Europe/Copenhagen','DK'),('Europe/Helsinki','FI'),('Europe/Warsaw','PL'),
    ('Europe/Prague','CZ'),('Europe/Budapest','HU'),('Europe/Bucharest','RO'),('Europe/Athens','GR'),
    ('Europe/Istanbul','TR'),('Europe/Kiev','UA'),('Europe/Kyiv','UA'),('Europe/Moscow','RU'),
    ('America/New_York','US'),('America/Chicago','US'),('America/Denver','US'),('America/Phoenix','US'),
    ('America/Los_Angeles','US'),('America/Anchorage','US'),('America/Detroit','US'),('Pacific/Honolulu','US'),
    ('America/Indiana/Indianapolis','US'),('America/Kentucky/Louisville','US'),('America/Boise','US'),
    ('America/Toronto','CA'),('America/Vancouver','CA'),('America/Edmonton','CA'),('America/Winnipeg','CA'),
    ('America/Halifax','CA'),('America/Montreal','CA'),('America/Mexico_City','MX'),('America/Sao_Paulo','BR'),
    ('America/Argentina/Buenos_Aires','AR'),('America/Bogota','CO'),('America/Lima','PE'),('America/Santiago','CL'),
    ('Asia/Dubai','AE'),('Asia/Riyadh','SA'),('Asia/Qatar','QA'),('Asia/Kuwait','KW'),('Asia/Bahrain','BH'),
    ('Asia/Muscat','OM'),('Asia/Jerusalem','IL'),('Asia/Amman','JO'),('Asia/Beirut','LB'),('Asia/Tehran','IR'),
    ('Asia/Karachi','PK'),('Asia/Kolkata','IN'),('Asia/Calcutta','IN'),('Asia/Dhaka','BD'),('Asia/Colombo','LK'),
    ('Asia/Kathmandu','NP'),('Asia/Bangkok','TH'),('Asia/Jakarta','ID'),('Asia/Singapore','SG'),
    ('Asia/Kuala_Lumpur','MY'),('Asia/Manila','PH'),('Asia/Ho_Chi_Minh','VN'),('Asia/Hong_Kong','HK'),
    ('Asia/Shanghai','CN'),('Asia/Taipei','TW'),('Asia/Seoul','KR'),('Asia/Tokyo','JP'),
    ('Australia/Sydney','AU'),('Australia/Melbourne','AU'),('Australia/Brisbane','AU'),('Australia/Perth','AU'),
    ('Australia/Adelaide','AU'),('Pacific/Auckland','NZ')
  ) v(t, c)
  where v.t = p_tz
$$;

-- Which goal (if any) one tracker event completes. Keys match GOALS in
-- src/pages/social/waUtils.js. Call booking was retired (2026-11): the old /book events
-- (form_submit, form_lead_captured) are no longer goals.
create or replace function public.wa_event_goal(p_type text, p_props jsonb)
returns text
language sql
immutable
as $$
  select case
    when p_type = 'gap_check_start' then 'scoper_start'
    when p_type = 'gap_check_report' then 'scoper_report'
    when p_type = 'gap_check_contact' then 'scoper_contact'
    when p_type = 'lead_form_submit' and p_props ->> 'offer' = 'custom' then 'custom_build'
    when p_type = 'lead_form_submit' and p_props ->> 'offer' = 'industry' then 'industry_enquiry'
    when p_type = 'lead_form_submit' then 'contact_form'
    when p_type in ('cta_click', 'click', 'outbound') and p_props ->> 'href' ~* '(^|//)(wa\.me|api\.whatsapp\.com)/' then 'whatsapp'
    when p_type = 'click' and p_props ->> 'kind' = 'tel' then 'phone'
    when p_type = 'click' and p_props ->> 'kind' = 'mailto' then 'email'
  end
$$;


-- 2. The report ----------------------------------------------------------------
create or replace function public.web_analytics_report(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_tz text default 'Africa/Nairobi',
  p_filters jsonb default '{}'::jsonb,
  p_interval text default 'day',
  p_compact boolean default false
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
  v_f jsonb := case when jsonb_typeof(p_filters) = 'object' then p_filters else '{}'::jsonb end;
  v_int text := case when p_interval in ('hour', 'day', 'week', 'month') then p_interval else 'day' end;
  v_fmt text;
  v_result jsonb;
begin
  if not public.wa_is_content_team() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  v_fmt := case v_int when 'hour' then 'YYYY-MM-DD"T"HH24:00' when 'month' then 'YYYY-MM' else 'YYYY-MM-DD' end;

  with ws_all as (
    select w.id, w.visitor_id, w.consented, w.is_returning, w.started_at, w.last_seen_at,
           w.channel, coalesce(w.source, '(direct)') as source, w.medium,
           w.referrer_domain, w.utm_campaign,
           coalesce(public.wa_norm_path(w.landing_path), '/') as entry,
           coalesce(w.device_type, 'unknown') as device,
           coalesce(w.browser, 'unknown') as browser,
           coalesce(w.os, 'unknown') as os,
           coalesce(public.wa_tz_country(w.timezone), 'ZZ') as country,
           coalesce(nullif(lower(split_part(coalesce(w.language, ''), '-', 1)), ''), 'unknown') as lang,
           rtrim(lower(coalesce(w.host, '')), '.') as hostname,
           w.pageviews, w.engaged_ms, w.max_scroll, w.lead_id,
           coalesce(w.visitor_id, w.id::text) as vkey
    from public.web_sessions w
    where w.started_at >= v_from and w.started_at < v_to
      and w.event_count > 0
      and coalesce(w.host, '') !~* '^(localhost|127\.0\.0\.1|\[::1\]|192\.168\.|10\.)'
  ),
  ev_all as (
    select e.session_id, e.occurred_at, e.id, e.type, e.props,
           public.wa_norm_path(e.path) as npath,
           public.wa_event_goal(e.type, e.props) as goal
    from public.web_events e
    join ws_all w on w.id = e.session_id
  ),
  sess_x as (
    select e.session_id,
           bool_or(e.type not in ('pageview', 'page_leave')) as interacted,
           (array_agg(e.npath order by e.occurred_at desc, e.id desc) filter (where e.type = 'pageview'))[1] as exit_path,
           array_agg(distinct e.goal) filter (where e.goal is not null) as goals
    from ev_all e
    group by e.session_id
  ),
  -- Filters are ANDed. Each one is skipped when absent from p_filters.
  s as (
    select w.*,
           x.exit_path,
           coalesce(x.goals, '{}') as goals,
           (w.pageviews <= 1 and w.engaged_ms < 10000 and not coalesce(x.interacted, false)) as bounced,
           coalesce(x.goals, '{}') && array['scoper_report', 'scoper_contact',
                                            'custom_build', 'industry_enquiry', 'contact_form',
                                            'whatsapp', 'phone', 'email'] as converted
    from ws_all w
    left join sess_x x on x.session_id = w.id
    where (v_f ->> 'channel' is null or w.channel = v_f ->> 'channel')
      and (v_f ->> 'source' is null or w.source = v_f ->> 'source')
      and (v_f ->> 'referrer' is null or w.referrer_domain = v_f ->> 'referrer')
      and (v_f ->> 'campaign' is null or w.utm_campaign = v_f ->> 'campaign')
      and (v_f ->> 'entry' is null or w.entry = v_f ->> 'entry')
      and (v_f ->> 'exit' is null or x.exit_path = v_f ->> 'exit')
      and (v_f ->> 'device' is null or w.device = v_f ->> 'device')
      and (v_f ->> 'browser' is null or w.browser = v_f ->> 'browser')
      and (v_f ->> 'os' is null or w.os = v_f ->> 'os')
      and (v_f ->> 'country' is null or w.country = v_f ->> 'country')
      and (v_f ->> 'language' is null or w.lang = v_f ->> 'language')
      and (v_f ->> 'hostname' is null or w.hostname = v_f ->> 'hostname')
      and (v_f ->> 'goal' is null or (v_f ->> 'goal') = any (coalesce(x.goals, '{}')))
      and (v_f ->> 'page' is null or exists (
            select 1 from ev_all p where p.session_id = w.id and p.type = 'pageview' and p.npath = v_f ->> 'page'))
  ),
  ev as (
    select e.* from ev_all e join s on s.id = e.session_id
  ),
  -- A lead is credited to the first session that carried it (the reminder
  -- email opens a second session for the same lead).
  lead_first as (
    select distinct on (w.lead_id) w.lead_id, w.id as session_id
    from public.web_sessions w
    where w.lead_id is not null
    order by w.lead_id, w.started_at, w.id
  ),
  leads_s as (
    select s.id as session_id, l.id as lead_id,
           (l.classification in ('hot', 'warm') and not coalesce(l.is_disqualified, false)) as qualified
    from s
    join lead_first lf on lf.session_id = s.id
    join public.leads l on l.id = lf.lead_id
  ),
  -- Funnel steps per event; the highest step a visit reached implies the
  -- earlier ones, so each funnel can only narrow. Step 1 is every visit.
  fsteps as (
    select e.session_id, f.funnel, max(f.step) as step
    from ev e
    cross join lateral (values
      ('contact', case
         when e.type = 'lead_form_submit' and e.props ->> 'offer' = 'contact' then 4
         when e.type = 'lead_form_start' and e.props ->> 'offer' = 'contact' then 3
         when e.type = 'pageview' and e.npath = '/contact' then 2 end),
      ('scoper', case
         when e.type = 'gap_check_contact' then 6
         when e.type = 'gap_check_report' then 5
         when e.type = 'gap_check_first_answer' then 4
         when e.type = 'gap_check_start' then 3
         when e.type = 'gap_check_form_start' or (e.type = 'pageview' and e.npath = '/ai-gap-check') then 2 end),
      ('custom', case
         when e.type = 'lead_form_submit' and e.props ->> 'offer' = 'custom' then 4
         when e.type = 'lead_form_start' and e.props ->> 'offer' = 'custom' then 3
         when e.type = 'pageview' and e.npath = '/custom-builds' then 2 end)
    ) f(funnel, step)
    where f.step is not null
    group by e.session_id, f.funnel
  ),
  total as (select count(*)::numeric as n from s)
  select jsonb_build_object(
    'kpis', (
      select jsonb_build_object(
        'visitors', count(distinct vkey),
        'visits', count(*),
        'pageviews', coalesce(sum(pageviews), 0),
        'views_per_visit', coalesce(round(avg(pageviews)::numeric, 2), 0),
        'bounce_rate', case when count(*) > 0 then round(100.0 * count(*) filter (where bounced) / count(*), 1) else 0 end,
        'visit_duration', coalesce(round(avg(engaged_ms) / 1000.0), 0),
        'conversions', count(*) filter (where converted),
        'conversion_rate', case when count(*) > 0 then round(100.0 * count(*) filter (where converted) / count(*), 1) else 0 end,
        'leads', (select count(*) from leads_s),
        'qualified', (select count(*) filter (where qualified) from leads_s),
        'returning', count(*) filter (where is_returning)
      ) from s
    ),
    'series', coalesce((
      select jsonb_agg(t order by t.bucket)
      from (
        select to_char(date_trunc(v_int, started_at at time zone p_tz), v_fmt) as bucket,
               count(distinct vkey) as visitors,
               count(*) as visits,
               coalesce(sum(pageviews), 0) as pageviews,
               round(100.0 * count(*) filter (where bounced) / count(*), 1) as bounce_rate,
               round(avg(engaged_ms) / 1000.0) as visit_duration,
               count(*) filter (where converted) as conversions,
               round(100.0 * count(*) filter (where converted) / count(*), 1) as conversion_rate
        from s group by 1
      ) t
    ), '[]'::jsonb),
    'goals', coalesce((
      select jsonb_agg(g order by g.visits desc)
      from (
        select ev.goal, count(distinct ev.session_id) as visits, count(*) as completions,
               count(distinct s.vkey) as visitors
        from ev join s on s.id = ev.session_id
        where ev.goal is not null
        group by ev.goal
      ) g
    ), '[]'::jsonb),
    'funnels', (
      select jsonb_build_object(
        'contact', jsonb_build_array((select n from total),
          (select count(*) from fsteps where funnel = 'contact' and step >= 2),
          (select count(*) from fsteps where funnel = 'contact' and step >= 3),
          (select count(*) from fsteps where funnel = 'contact' and step >= 4)),
        'scoper', jsonb_build_array((select n from total),
          (select count(*) from fsteps where funnel = 'scoper' and step >= 2),
          (select count(*) from fsteps where funnel = 'scoper' and step >= 3),
          (select count(*) from fsteps where funnel = 'scoper' and step >= 4),
          (select count(*) from fsteps where funnel = 'scoper' and step >= 5),
          (select count(*) from fsteps where funnel = 'scoper' and step >= 6)),
        'custom', jsonb_build_array((select n from total),
          (select count(*) from fsteps where funnel = 'custom' and step >= 2),
          (select count(*) from fsteps where funnel = 'custom' and step >= 3),
          (select count(*) from fsteps where funnel = 'custom' and step >= 4))
      )
    ),
    'live', case when p_compact then null else (
      select count(*) from public.web_sessions
      where last_seen_at > now() - interval '5 minutes'
        and coalesce(host, '') !~* '^(localhost|127\.0\.0\.1|\[::1\]|192\.168\.|10\.)'
    ) end,
    'channels', case when p_compact then null else coalesce((
      select jsonb_agg(x order by x.visitors desc, x.name) from (
        select channel as name, count(distinct vkey) as visitors, count(*) as visits,
               count(*) filter (where converted) as conversions,
               round(100.0 * count(*) filter (where bounced) / count(*)) as bounce_rate
        from s group by channel) x), '[]'::jsonb) end,
    'sources', case when p_compact then null else coalesce((
      select jsonb_agg(x order by x.visitors desc, x.name) from (
        select source as name, max(channel) as channel, count(distinct vkey) as visitors, count(*) as visits,
               count(*) filter (where converted) as conversions,
               round(100.0 * count(*) filter (where bounced) / count(*)) as bounce_rate
        from s group by source order by count(distinct vkey) desc limit 50) x), '[]'::jsonb) end,
    'referrers', case when p_compact then null else coalesce((
      select jsonb_agg(x order by x.visitors desc, x.name) from (
        select referrer_domain as name, count(distinct vkey) as visitors, count(*) as visits,
               count(*) filter (where converted) as conversions,
               round(100.0 * count(*) filter (where bounced) / count(*)) as bounce_rate
        from s where referrer_domain is not null
        group by referrer_domain order by count(distinct vkey) desc limit 50) x), '[]'::jsonb) end,
    'campaigns', case when p_compact then null else coalesce((
      select jsonb_agg(x order by x.visitors desc, x.name) from (
        select utm_campaign as name, count(distinct vkey) as visitors, count(*) as visits,
               count(*) filter (where converted) as conversions,
               round(100.0 * count(*) filter (where bounced) / count(*)) as bounce_rate
        from s where utm_campaign is not null
        group by utm_campaign order by count(distinct vkey) desc limit 50) x), '[]'::jsonb) end,
    'pages', case when p_compact then null else coalesce((
      select jsonb_agg(x order by x.visitors desc, x.pageviews desc, x.name) from (
        select e.npath as name,
               count(distinct s.vkey) filter (where e.type = 'pageview') as visitors,
               count(*) filter (where e.type = 'pageview') as pageviews,
               round(avg(case when e.type = 'page_leave' and e.props ->> 'engaged_ms' ~ '^\d{1,9}$'
                              then least((e.props ->> 'engaged_ms')::bigint, 3600000) end) / 1000.0) as time_on_page,
               round(avg(case when e.type = 'page_leave' and e.props ->> 'max_scroll' ~ '^\d{1,3}$'
                              then (e.props ->> 'max_scroll')::int end)) as scroll
        from ev e join s on s.id = e.session_id
        where e.type in ('pageview', 'page_leave') and e.npath is not null
        group by e.npath
        having count(*) filter (where e.type = 'pageview') > 0
        order by count(distinct s.vkey) filter (where e.type = 'pageview') desc limit 50) x), '[]'::jsonb) end,
    'entry_pages', case when p_compact then null else coalesce((
      select jsonb_agg(x order by x.visitors desc, x.name) from (
        select entry as name, count(distinct vkey) as visitors, count(*) as visits,
               count(*) filter (where converted) as conversions,
               round(100.0 * count(*) filter (where bounced) / count(*)) as bounce_rate
        from s group by entry order by count(distinct vkey) desc limit 50) x), '[]'::jsonb) end,
    'exit_pages', case when p_compact then null else coalesce((
      select jsonb_agg(x order by x.visitors desc, x.name) from (
        select s.exit_path as name, count(distinct s.vkey) as visitors, count(*) as exits,
               round(100.0 * count(*) / nullif((
                 select count(*) from ev p where p.type = 'pageview' and p.npath = s.exit_path), 0)) as exit_rate
        from s where s.exit_path is not null
        group by s.exit_path order by count(distinct s.vkey) desc limit 50) x), '[]'::jsonb) end,
    'devices', case when p_compact then null else coalesce((
      select jsonb_agg(x order by x.visitors desc, x.name) from (
        select device as name, count(distinct vkey) as visitors, count(*) as visits,
               count(*) filter (where converted) as conversions
        from s group by device) x), '[]'::jsonb) end,
    'browsers', case when p_compact then null else coalesce((
      select jsonb_agg(x order by x.visitors desc, x.name) from (
        select browser as name, count(distinct vkey) as visitors, count(*) as visits,
               count(*) filter (where converted) as conversions
        from s group by browser) x), '[]'::jsonb) end,
    'systems', case when p_compact then null else coalesce((
      select jsonb_agg(x order by x.visitors desc, x.name) from (
        select os as name, count(distinct vkey) as visitors, count(*) as visits,
               count(*) filter (where converted) as conversions
        from s group by os) x), '[]'::jsonb) end,
    'countries', case when p_compact then null else coalesce((
      select jsonb_agg(x order by x.visitors desc, x.name) from (
        select country as name, count(distinct vkey) as visitors, count(*) as visits,
               count(*) filter (where converted) as conversions
        from s group by country) x), '[]'::jsonb) end,
    'languages', case when p_compact then null else coalesce((
      select jsonb_agg(x order by x.visitors desc, x.name) from (
        select lang as name, count(distinct vkey) as visitors, count(*) as visits,
               count(*) filter (where converted) as conversions
        from s group by lang) x), '[]'::jsonb) end,
    'hostnames', case when p_compact then null else coalesce((
      select jsonb_agg(x order by x.visitors desc, x.name) from (
        select hostname as name, count(distinct vkey) as visitors, count(*) as visits,
               count(*) filter (where converted) as conversions
        from s group by hostname) x), '[]'::jsonb) end,
    'events', case when p_compact then null else coalesce((
      select jsonb_agg(x order by x.visits desc, x.name) from (
        select type as name, count(distinct session_id) as visits, count(*) as events
        from ev where type not in ('pageview', 'page_leave')
        group by type order by count(distinct session_id) desc limit 50) x), '[]'::jsonb) end
  ) into v_result;

  return v_result;
end;
$$;


-- 3. Search Console --------------------------------------------------------------
-- Site totals come from seo_daily (includes anonymised queries). With a query
-- or page filter they come from seo_queries instead, the only table that has
-- those dimensions.
create or replace function public.seo_report(
  p_from date default null,
  p_to date default null,
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from date := coalesce(p_from, '2000-01-01'::date);
  v_to date := coalesce(p_to, current_date + 1);
  v_f jsonb := case when jsonb_typeof(p_filters) = 'object' then p_filters else '{}'::jsonb end;
  v_filtered boolean;
  v_result jsonb;
begin
  if not public.wa_is_content_team() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  v_filtered := v_f ->> 'query' is not null or v_f ->> 'page' is not null;

  with q as (
    select date, query, page, clicks, impressions, position,
           coalesce(public.wa_norm_path(regexp_replace(page, '^https?://[^/]+', '')), '/') as path
    from public.seo_queries
    where date between v_from and v_to
      and (v_f ->> 'query' is null or query = v_f ->> 'query')
  ),
  qf as (
    select * from q where v_f ->> 'page' is null or path = v_f ->> 'page'
  ),
  daily as (
    select date, clicks::numeric as clicks, impressions::numeric as impressions, position::numeric as position
    from public.seo_daily where not v_filtered and date between v_from and v_to
    union all
    select date, sum(clicks), sum(impressions), sum(position * impressions) / nullif(sum(impressions), 0)
    from qf where v_filtered group by date
  ),
  -- Organic visits from our own tracker, by landing page, with conversions.
  org as (
    select coalesce(public.wa_norm_path(w.landing_path), '/') as path,
           count(*) as visits,
           count(*) filter (where exists (
             select 1 from public.web_events e
             where e.session_id = w.id and public.wa_event_goal(e.type, e.props) is not null
               and public.wa_event_goal(e.type, e.props) <> 'scoper_start')) as conversions
    from public.web_sessions w
    where w.channel = 'Organic Search'
      and w.started_at >= v_from::timestamptz and w.started_at < (v_to + 1)::timestamptz
    group by 1
  )
  select jsonb_build_object(
    'filtered', v_filtered,
    'status', (
      select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
      from public.system_settings
      where key in ('gsc_site_url', 'gsc_last_sync_at', 'gsc_last_sync_status')
    ),
    'totals', (
      select jsonb_build_object(
        'clicks', coalesce(sum(clicks), 0),
        'impressions', coalesce(sum(impressions), 0),
        'ctr', case when sum(impressions) > 0 then round(100 * sum(clicks) / sum(impressions), 2) else 0 end,
        'position', round(sum(position * impressions) / nullif(sum(impressions), 0), 1),
        'first_date', min(date),
        'last_date', max(date)
      ) from daily
    ),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', date, 'clicks', clicks, 'impressions', impressions,
        'ctr', case when impressions > 0 then round(100 * clicks / impressions, 2) else 0 end,
        'position', round(position, 1)) order by date)
      from daily
    ), '[]'::jsonb),
    'queries', coalesce((
      select jsonb_agg(x order by x.clicks desc, x.impressions desc) from (
        select query as name, sum(clicks)::int as clicks, sum(impressions)::int as impressions,
               case when sum(impressions) > 0 then round(100.0 * sum(clicks) / sum(impressions), 2) else 0 end as ctr,
               round((sum(position * impressions) / nullif(sum(impressions), 0))::numeric, 1) as position
        from qf group by query
        order by sum(clicks) desc, sum(impressions) desc limit 100) x), '[]'::jsonb),
    'pages', coalesce((
      select jsonb_agg(x order by x.clicks desc, x.impressions desc) from (
        select pg.*, coalesce(org.visits, 0) as organic_visits, coalesce(org.conversions, 0) as organic_conversions
        from (
          select path as name, sum(clicks)::int as clicks, sum(impressions)::int as impressions,
                 case when sum(impressions) > 0 then round(100.0 * sum(clicks) / sum(impressions), 2) else 0 end as ctr,
                 round((sum(position * impressions) / nullif(sum(impressions), 0))::numeric, 1) as position
          from qf group by path
          order by sum(clicks) desc, sum(impressions) desc limit 100
        ) pg left join org on org.path = pg.name) x), '[]'::jsonb),
    -- Ranking on page 1-2 but not yet winning the click: the cheapest SEO wins.
    'opportunities', coalesce((
      select jsonb_agg(x order by x.impressions desc) from (
        select query as name, sum(clicks)::int as clicks, sum(impressions)::int as impressions,
               case when sum(impressions) > 0 then round(100.0 * sum(clicks) / sum(impressions), 2) else 0 end as ctr,
               round((sum(position * impressions) / nullif(sum(impressions), 0))::numeric, 1) as position
        from qf group by query
        having sum(impressions) >= 10
           and sum(position * impressions) / nullif(sum(impressions), 0) between 4 and 20
        order by sum(impressions) desc limit 25) x), '[]'::jsonb),
    'countries', coalesce((
      select jsonb_agg(x order by x.clicks desc, x.impressions desc) from (
        select upper(value) as name, sum(clicks)::int as clicks, sum(impressions)::int as impressions,
               round((sum(position * impressions) / nullif(sum(impressions), 0))::numeric, 1) as position
        from public.seo_dimension_daily
        where dimension = 'country' and date between v_from and v_to
        group by value order by sum(clicks) desc, sum(impressions) desc limit 50) x), '[]'::jsonb),
    'devices', coalesce((
      select jsonb_agg(x order by x.clicks desc, x.impressions desc) from (
        select lower(value) as name, sum(clicks)::int as clicks, sum(impressions)::int as impressions,
               round((sum(position * impressions) / nullif(sum(impressions), 0))::numeric, 1) as position
        from public.seo_dimension_daily
        where dimension = 'device' and date between v_from and v_to
        group by value) x), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;


-- 4. Grants ----------------------------------------------------------------------
revoke all on function public.web_analytics_report(timestamptz, timestamptz, text, jsonb, text, boolean) from public, anon;
revoke all on function public.seo_report(date, date, jsonb) from public, anon;
grant execute on function public.web_analytics_report(timestamptz, timestamptz, text, jsonb, text, boolean) to authenticated;
grant execute on function public.seo_report(date, date, jsonb) to authenticated;

notify pgrst, 'reload schema';
