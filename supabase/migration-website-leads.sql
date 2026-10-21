-- ============================================================
-- Website leads: columns for the five forms on sdfmgroup.com (safe to re-run)
--
-- The website-lead Edge Function saves every form submission (AI gap assessment, free guide, industry
-- software, custom build, contact) as an inquiry with channel 'website'. This migration adds the fields
-- those forms collect, so the CRM can filter and report on them. Nothing changes for existing rows or
-- for the way staff work inquiries.
--
-- The function works without this migration (it then keeps the same details inside the message text),
-- so it is safe to deploy the function first.
--
-- Run in the Supabase SQL Editor after migration-inquiries.sql.
-- ============================================================

alter table public.inquiries add column if not exists offer text;
alter table public.inquiries add column if not exists staff_band text;
alter table public.inquiries add column if not exists sector text;
alter table public.inquiries add column if not exists interest text;
alter table public.inquiries add column if not exists past_work text;
alter table public.inquiries add column if not exists page_url text;
alter table public.inquiries add column if not exists referrer text;
alter table public.inquiries add column if not exists utm_source text;
alter table public.inquiries add column if not exists utm_medium text;
alter table public.inquiries add column if not exists utm_campaign text;
alter table public.inquiries add column if not exists utm_term text;

alter table public.inquiries drop constraint if exists inquiries_offer_check;
alter table public.inquiries
  add constraint inquiries_offer_check
  check (offer is null or offer in ('assessment', 'guide', 'industry', 'custom', 'contact', 'gap_check'));

alter table public.inquiries drop constraint if exists inquiries_staff_band_check;
alter table public.inquiries
  add constraint inquiries_staff_band_check
  check (staff_band is null or staff_band in ('1-5', '6-15', '16-50', '51-100', '100+'));

create index if not exists inquiries_offer_idx on public.inquiries (offer, received_at desc)
  where offer is not null;
