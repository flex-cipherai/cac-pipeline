-- ============================================================
-- Social Media Management — history import
--
-- Account-level analytics for API-connected accounts become ONE ROW PER DAY
-- (period_date), written by the one-time history import (sm-import-history,
-- up to 12 months back) and refreshed for the last few days by the hourly
-- sync. That makes account totals the platform's own daily page totals
-- (including posts made outside the BMS) with no double counting.
-- Posts published directly on the platform can be imported (posts.origin =
-- 'imported') with their lifetime stats.
--
-- Run after migration-social-v2.sql. Safe to run more than once.
-- ============================================================

alter table public.analytics_snapshots
  add column if not exists period_date date;

-- Not partial, so it can back an upsert's ON CONFLICT (account_id, period_date);
-- manual, CSV and post-level rows have a NULL period_date and never clash.
create unique index if not exists analytics_snapshots_account_day_idx
  on public.analytics_snapshots (account_id, period_date);

-- The two follower readings the earlier sync stored without a day; the
-- import rebuilds the follower trend day by day.
delete from public.analytics_snapshots
where post_id is null and source = 'api' and period_date is null;

alter table public.posts
  add column if not exists origin text not null default 'bms';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'posts_origin_check') then
    alter table public.posts add constraint posts_origin_check check (origin in ('bms', 'imported'));
  end if;
end $$;

alter table public.connected_accounts
  add column if not exists history_imported_at timestamptz,
  add column if not exists history_import_note text;
