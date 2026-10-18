-- ============================================================
-- Retire the old booking links in emails (safe to re-run)
--
-- sdfmgroup.com/book no longer exists (it redirects to the AI gap assessment page), so two email
-- templates would send people to the wrong place:
--
--   booking_nudge_client  "Finish booking your call": its only button is the old booking page. Switched
--                         off. The send-booking-nudges function does nothing while it is inactive.
--   booking_confirmed     the confirmation for calls that were already booked. Everything stays except
--                         the paragraph that links to the old "answer 5 quick questions" page.
--
-- Run in the Supabase SQL Editor. Staff can still switch the nudge back on from the Notifications page.
-- ============================================================

update public.email_templates
set is_active = false
where template_key = 'booking_nudge_client';

update public.email_templates
set body_html = regexp_replace(
      body_html,
      '\s*<p[^>]*>[^<]*<a href="\{\{prep_link\}\}"[^>]*>[^<]*</a>[^<]*</p>',
      '',
      'g'
    )
where template_key = 'booking_confirmed'
  and body_html like '%{{prep_link}}%';

-- Check: this should return no rows (no active template still links to the old pages).
select template_key from public.email_templates
where (body_html like '%{{prep_link}}%' or body_html like '%{{resume_link}}%')
  and is_active;
