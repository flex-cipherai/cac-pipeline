-- ============================================================
-- Website Analytics — scheduled jobs (pg_cron + pg_net)
--
-- The Search Console sync job (wa-gsc-sync) now lives in
-- migration-website-analytics-gsc-cron.sql; this file only holds the purge.
--
-- purge:        Sundays 03:00 UTC, deletes raw web sessions/events older
--                  than 760 days (~25 months) to keep the tables small.
--
-- Run in the Supabase SQL Editor, after migration-website-analytics.sql.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'wa-purge-old-data') then
    perform cron.unschedule('wa-purge-old-data');
  end if;
end $$;

select cron.schedule(
  'wa-purge-old-data',
  '0 3 * * 0',
  $$ select public.wa_purge_old_web_data(760); $$
);
