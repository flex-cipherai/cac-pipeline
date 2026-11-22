-- ============================================================
-- Automation scoper — review scope (safe to re-run)
--
-- The scoper now starts by asking what to review: the whole business (a general review of every
-- business area) or one department in depth (sales, marketing, customer service, operations,
-- finance, people and HR, inventory, data and IT). The choice is stored on the session so the
-- interview, the report and the BMS all follow it.
--
--   review_type        'general' | 'department'   (existing rows: general)
--   review_department  department key when review_type = 'department', else null
--
-- Columns only; no data is changed. The gap-assessment function still works before this has run
-- (it keeps the choice in report_internal and drops these columns on insert).
-- ============================================================

alter table public.gap_assessments
  add column if not exists review_type text not null default 'general',
  add column if not exists review_department text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gap_assessments_review_type_check') then
    alter table public.gap_assessments
      add constraint gap_assessments_review_type_check check (review_type in ('general', 'department'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'gap_assessments_review_department_check') then
    alter table public.gap_assessments
      add constraint gap_assessments_review_department_check check (
        (review_type = 'general' and review_department is null)
        or (review_type = 'department' and review_department ~ '^[a-z][a-z0-9_]{1,30}$')
      );
  end if;
end $$;

create index if not exists gap_assessments_review_idx on public.gap_assessments (review_type, review_department);

notify pgrst, 'reload schema';
