# SDFM Business Management Solution

Business management system for SDFM Group Limited. Manages the full sales lifecycle from lead intake through contract signing, plus LinkedIn social media management (composer, calendar, bulk scheduling, approvals, analytics, activity inbox) under `/social/*` — see `SDFM Social Media Management System Description.pdf` for the module spec. Both modules share the same Supabase project, roles (`admin`, `sales`, `marketing`), and deploy pipeline.

## Tech Stack

- **Frontend:** React (Vite)
- **Backend:** Supabase (PostgreSQL, Auth, RLS)
- **Deployment:** Netlify
- **Styling:** Plain CSS (SDFM Brand Guidelines)

## Structure

```
cac-pipeline/
├── public/              # Static assets + sdfm-tracker.js (first-party website tracker)
├── src/
│   ├── components/      # Reusable components
│   │   ├── Layout/      # Sidebar and layout
│   │   └── LinkedInPostPreview/  # Composer live preview
│   ├── pages/           # Route pages
│   │   └── social/      # Social Media Management module (composer, calendar, etc.)
│   ├── lib/             # Supabase client, scoring logic, auth, UTM builder
│   └── styles/          # Global CSS, variables, and shared-ui (modal/toast/status-badge)
├── supabase/
│   ├── schema.sql               # Core sales pipeline schema
│   ├── migration-social-media.sql          # Social media data model, RLS, storage bucket
│   ├── migration-social-notifications.sql  # In-app notifications + email templates
│   ├── migration-social-scheduler-cron.sql # pg_cron jobs for the social media module
│   ├── migration-social-linkedin-oauth.sql # Phase 2: LinkedIn OAuth token storage
│   ├── migration-website-analytics.sql     # Website analytics: sessions/events, funnel + SEO reports
│   ├── migration-website-analytics-cron.sql # pg_cron: daily Search Console sync, data retention
│   ├── migration-role-permissions.sql      # Settings → Permissions: which modules each role can open
│   ├── migration-permissions-enforcement.sql # Makes every module's database policies follow that table
│   ├── migration-inquiries.sql             # Inquiries: tables, RLS, convert_inquiry_to_lead()
│   ├── migration-inquiry-reminders.sql     # Inquiry reminder columns + email templates
│   ├── migration-inquiry-reminders-cron.sql # pg_cron: daily digest + hourly reply alerts
│   └── functions/sm-*/          # Social media Edge Functions (incl. sm-gsc-sync)
├── .env                 # Environment variables (not committed)
├── netlify.toml         # Netlify SPA routing config
└── vite.config.js       # Vite configuration
```

Run the `migration-social-*.sql` files (in that order) in the Supabase SQL Editor after `schema.sql`, deploy the `sm-*` Edge Functions, and set `app_base_url` in Settings → Content defaults once the site is live, to enable the Social Media Management module.

### Inquiries (`/inquiries`)

Tracks people who have reached out but are not leads yet, from first contact to a decision. Today most of that happens outside the system (WhatsApp, phone, email, LinkedIn messages, referrals, events), so nothing recorded it until someone booked a call. Sales Pipeline module; admin and sales by default (Settings → Permissions).

**How an inquiry moves**

- Staff **log** it (channel, who, what they asked, owner, optional follow-up date). The page warns if the same phone number or email already belongs to an inquiry or a lead.
- Status runs `new` → `contacted` → `engaged`, then ends as `converted` (it became a lead) or `closed` (with a reason: stopped responding, not a fit, not interested, duplicate, spam, other). Closed inquiries can be reopened.
- Logging a call, WhatsApp, email or meeting in the **Activity** tab stamps the first reply and last contact and moves a `new` inquiry to `contacted`. This is done by a database trigger, so the rule holds wherever activities are added. Notes do not count as a reply.
- **Turn into a lead** creates the lead through `convert_inquiry_to_lead()`, one transaction that also writes the lead's stage history, copies what they asked into the lead's notes and marks the inquiry converted. It cannot leave a lead behind with the inquiry still open, and it refuses a second conversion. If a lead with the same email or phone already exists, the dialog defaults to **Link to an existing lead** instead, so no duplicate is created.
- The new lead starts as "Not scored yet". Its stage defaults to `Incomplete` (a lead to follow up with no call booked); pick a pipeline stage if a call is already arranged. `nudge_sent_at` is stamped so the automatic "finish booking your call" email does not go to someone the team is already talking to.

**What needs attention** (rules in `src/lib/inquiries.js`)

- *Reply overdue*: still `new` after 24 hours (`REPLY_TARGET_HOURS`).
- *Follow-up due*: the follow-up date is today or earlier.
- *Gone quiet*: open, past `new`, no follow-up date and no contact for 7 days (`QUIET_AFTER_DAYS`).

The page opens on **Needs attention** when anything is flagged. There are no reminder emails for these yet; they show on the page.

**Reports.** The period selector filters by the date the inquiry was received. "Open now" and "Need attention" are always about right now. The channel table shows received, still open, became leads, conversion rate and median first reply per channel. "Became leads" is converted ÷ received in the period, so a recent period will read low until its inquiries have had time to convert. First-reply time is measured from the *received* time to when the reply was logged, so log inquiries promptly (or set the received time) for it to mean anything.

**Setup.** In the Supabase SQL Editor run, in order and each safe to re-run: `schema.sql`, `migration-booking-flow.sql`, `migration-role-permissions.sql`, then `migration-inquiries.sql`. Until it has run, the page shows a one-line setup notice instead of failing. Access follows Settings → Permissions (module "Inquiries") at the database level too, not just in the menu; only admin can delete an inquiry.

**Reminders.** Two scheduled jobs call the `send-inquiry-reminders` Edge Function. Each person gets one email per run listing their inquiries (their own, or everyone's who can use inquiries when an inquiry has no owner), plus an entry in the notification bell.

- *Daily digest*, 06:00 UTC (09:00 Nairobi): follow-ups due today or tomorrow, and inquiries that have gone quiet. Not sent when there is nothing to say.
- *Reply alerts*, hourly: new inquiries with no reply for 24 hours. Only sent 08:00–18:00 team time (the `team_timezone` setting); an overdue inquiry found at night goes out the next morning.
- Each reminder goes out once. Moving a follow-up date, or contacting someone again, re-arms the matching reminder. A missed day is caught up, not lost. If neither the email nor the bell could be delivered, nothing is marked sent and the next run tries again.
- The wording is two ordinary templates on the Notifications page ("Inquiry Follow-ups (daily digest)" and "Inquiry Waiting for a Reply"). Switching one off stops the email but keeps the bell. The 24 hours, 7 days and working hours are constants in `supabase/functions/_shared/inquiryReminders.ts` and must match `src/lib/inquiries.js`.

Setup: run `migration-inquiry-reminders.sql`; `supabase functions deploy send-inquiry-reminders --no-verify-jwt` (same `RESEND_API_KEY` / `SENDER_EMAIL` secrets as the other reminder functions); fill in `YOUR_PROJECT_URL` / `YOUR_ANON_KEY` in `migration-inquiry-reminders-cron.sql` and run it. To check it, invoke the function with `{"mode":"daily"}` and read the JSON it returns.

### Automation Scoper (`/assessments`)

The free assessment tool on the marketing site (`cac-website/ai-gap-check.html`), run from this system. A visitor gives name, work email, company and website, has a short AI-led conversation, and gets a gap report with projected ROI that they can download as a PDF. The report deliberately has **no priority order and no per-opportunity cost**; the page and the PDF say so and point to the paid assessment. This module is where staff read what visitors saw, plus the working behind it.

- **Who sees what.** `gap_assessments.report` is the visitor's report. `report_internal` holds the working (people, hours, hourly cost, estimated investment per gap and in total); only staff see it, in the drawer's "Sales view" boxes. The browser only ever holds a random session token; the database stores its SHA-256.
- **On completion** an inquiry is created (channel `website`, offer `gap_check`, follow-up the next day, message = headline numbers + link to `/assessments?id=...`) and everyone with the `assessments` module is emailed. Visitors who stop partway stay in the "In progress" tab with their transcript; unfinished sessions can be purged with `purge_stale_gap_assessments()` (30 days).
- **Code.** All behaviour is in `supabase/functions/_shared/gapService.ts` (actions `start`, `chat`, `report`, `resume`, `event`), written against a small `Store` interface and tested under Node with an in-memory store, a fake Gemini, fake DNS and a fake website. `gapAssessment.ts` holds the pure rules (validation, prompts, report sanitising, the ROI engine) and is imported by the CRM too, so the settings screen and the tool share one set of defaults (`gapDefaults.ts`). `llm.ts` is the Gemini client (model, then fallback model), `netChecks.ts` does the email-domain and website checks over DNS-over-HTTPS. `gap-assessment/index.ts` only connects these to Supabase and Resend.
- **ROI.** The model reads the conversation and proposes numbers per gap (people, hours a week, lost revenue, confidence); the server clamps them and does the arithmetic from the assumptions in Settings → Automation scoper: time value = people × hours × share removed by that kind of fix × weeks × hourly cost, plus a share of any quantified lost revenue. Totals are capped at staff × a per-employee ceiling. ROI and payback compare against an internal typical-cost assumption; the cost itself is never sent to the browser.
- **Abuse limits.** Honeypot and minimum fill time, 5 starts per hour per network, 3 per email per day, a daily cap on all sessions (default 50; one assessment makes about 14 model calls, so size it to your plan's requests-per-day limit), a turn cap per session, a processing lock so two taps cannot run two model calls, work email required (free and disposable domains rejected, MX checked), and website fetching only to public hosts (every redirect re-checked).
- **Privacy.** On Gemini's free tier Google may use prompts to improve its products and have humans review them. The consent text and the privacy policy (`#ai-gap-check`) say answers go to Google Gemini; switching the API key's project to a paid plan removes that. Do that before promoting the tool widely.
- **Setup (in order):** run `migration-gap-assessments.sql` (after `migration-inquiries.sql` and `migration-role-permissions.sql`; it also widens the `inquiries.offer` check, as `migration-website-leads.sql` now does); `supabase secrets set GEMINI_API_KEY=...` (Google AI Studio; `RESEND_API_KEY` and `SENDER_EMAIL` are the existing ones); `supabase functions deploy gap-assessment --no-verify-jwt`; then deploy the website. Open Settings → Automation scoper and check the two model names exist on your plan.

### Settings

Settings is split into sub-modules, one page each under `/settings/*` with a grouped side navigation (a swipeable tab strip on phones). `/settings` forwards to the first page the person may open.

| Group | Page | Who |
|---|---|---|
| Account | My profile (`/settings/profile`) | switchable per role (default admin, sales) |
| Workspace | Booking & availability (`/settings/booking`) | switchable per role (default admin, sales) |
| Workspace | Automation scoper: questions, ROI assumptions, AI model and limits (`/settings/assessment`) | admin only |
| Workspace | Scoring (`/settings/scoring`) | admin only |
| Social media | Integrations: LinkedIn, Google Search Console (`/settings/integrations`) | admin only |
| Social media | Content defaults and hashtag sets (`/settings/content`) | admin only |
| Access | Users (`/settings/users`) | admin only |
| Access | Permissions (`/settings/permissions`) | admin only |

Each page is a permission module (`settings_*` in `src/lib/permissions.js`) and lives in `src/pages/settings/`. The LinkedIn connect flow still returns to `/settings?linkedin=...`; that is forwarded to Integrations. Saves report real failures: the database refuses a change the person has no right to make, and the page now says so instead of showing "saved".

### Permissions (Settings → Permissions)

Admins choose which modules the **sales** and **marketing** roles can open. Admin always has everything and cannot be edited; it has no rows (a database check prevents one), so a bad edit cannot lock the admin out. Modules marked admin-only (user management, scoring, integrations, content defaults, the permissions screen itself) are shown in the matrix but cannot be given to another role. The modules are listed in `src/lib/permissions.js`; the table is `role_permissions`.

The one table is enforced in three places, so the menu, the pages and the data cannot disagree:

1. **The app:** the sidebar and routes. A page the user cannot open redirects to the first one they can; a role with nothing enabled sees a "No modules available" page. Permissions are read at login and again whenever a tab comes back into view, so a change reaches people already signed in.
2. **The database:** `migration-permissions-enforcement.sql` replaces every module table's row level security policies with rules that call `has_module_access()` / `has_any_module_access()`. Switch a module off for a role and its data stops being readable or writable by that role, whatever the app does. The rules are listed in section 3 of that file, one line per table, with the modules whose pages use it. A table shared by several modules (leads, for example) is open to any of them. Not delegable on purpose: deciding on a post for approval, connected accounts, and user management stay admin-only.
3. **The Edge Functions:** who receives lead alerts, call and follow-up reminders, social alerts and the weekly digest, and who may trigger a Search Console sync, now come from the same table (`supabase/functions/_shared/access.ts`) instead of fixed role lists. Deactivated users are never emailed.

Settings → Permissions shows an amber banner until the enforcement migration has been applied, because until then the switches only change menus and pages.

- **Adding a module:** an entry in `permissions.js`, a route in `App.jsx`, a sidebar item (or a Settings sub-page), a seed row in `migration-role-permissions.sql`, and the table rules in section 3 of `migration-permissions-enforcement.sql`. In the app, a module with no stored row falls back to who could open it before permissions existed; the database treats a missing row as no access. That is why saving writes every row.
- **Setup (in order, each safe to re-run):** `migration-role-permissions.sql`; `migration-booking-lockdown.sql` if not already run; `migration-permissions-enforcement.sql`. The seed gives each role exactly the access it had before, so nothing changes until an admin edits the table. The enforcement migration refuses to run while any managed table still allows anonymous access (it names the policies), and it deletes every other existing policy on the tables it manages, including ones made by hand in the dashboard. Before the permissions migration has run, everyone keeps the original access and the Settings page shows a setup notice.
- **Deliberate tightenings:** with the default seed each role keeps its current working access. What changes is that a role with no lead-related module can no longer read the leads tables, sales can no longer write settings other than the booking ones, and the leads, quotation and template tables are no longer open to every signed-in user.

### Phase 2 — LinkedIn API (Community Management API)

Assisted Mode (manual copy/paste publishing, manual analytics entry) works with zero LinkedIn API access — see the module description PDF. Phase 2 adds direct API publishing once LinkedIn approves the app for the **Community Management API** product (a reviewed application at developer.linkedin.com, distinct from and much lighter-weight than the ads-focused Marketing Developer Platform).

- `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` — set as Supabase Edge Function secrets (`supabase secrets set`), never in `.env` or frontend code.
- `supabase/migration-social-linkedin-oauth.sql` — adds `connected_account_tokens` (access/refresh tokens, service-role only, no RLS policies granted to any client role) and `oauth_states` (CSRF protection for the OAuth handshake).
- `sm-linkedin-oauth-start` — admin-only, called from Settings → Integrations ("Connect LinkedIn"); returns the LinkedIn authorization URL.
- `sm-linkedin-oauth-callback` — deployed with `--no-verify-jwt` since LinkedIn's browser redirect hits it directly (no Supabase session). Exchanges the code for tokens, resolves the administered LinkedIn Organization (requires `rw_organization_admin`, only grantable post-approval), and redirects back to `/settings`.
- The LinkedIn app's **Authorized redirect URL** must be set to `https://<project-ref>.supabase.co/functions/v1/sm-linkedin-oauth-callback` — not the app's own domain, since only the Edge Function can hold the Client Secret for the token exchange.
- `connected_accounts.mode` flips to `automated` automatically once an Organization is resolved; until LinkedIn approves the API product, the account can be OAuth-connected but stays in Assisted Mode (`oauth_connected = true`, `mode = 'assisted'`) — no manual toggle needed.
- `supabase/functions/_shared/linkedin.ts` has the token exchange/refresh helpers `sm-publish` / `sm-fetch-analytics` / `sm-fetch-activity` will use once built.

### Website Analytics (`/social/website-analytics`)

Answers three questions in one place: **How are people finding us? What are they doing on the website? Are they turning into qualified leads?** It combines first-party website tracking, Lead Intake Form funnel analytics, Google Search Console (SEO) and lead conversion data.

**How it fits together**

- `public/sdfm-tracker.js` is a small first-party script, installed on every page of `sdfmgroup.com` (including `/book`). It records pageviews, time on page, scroll depth, link/button clicks (labels only), outbound links, downloads and site form submissions, and sends them in batches to the `track_web_batch` database function.
- The whole visitor journey is on one domain, so no session hand-off is needed: a lead is credited to how the visit **first** arrived (channel, source, campaign, landing page).
- The booking page (`/book`, `cac-website/js/book.js`) reports `form_view`, `form_start`, `form_step_view` / `form_step_complete` (step 1 details, 2 time, 3 booked), `form_lead_captured`, `form_slot_selected`, `form_submit`, `form_error` (with a `stage`), `form_resume`, `form_answer`, `prep_view`, `prep_complete`, `prep_skip` and a `download_ics` click. No name, email or phone is ever sent; the lead id is sent only to link the visit to the lead it produced.
- Call-to-action buttons on the site carry `data-sdfm-cta` and a `data-sdfm-label` naming their placement (`hero_book`, `contact_whatsapp`, ...). `CTA_PLACEMENTS` in `WebsiteAnalytics.jsx` maps those labels to readable names; add an entry when you add a CTA. The route (book / WhatsApp / phone / email) is derived from the link target.
- Reports are computed in Postgres (`web_analytics_*`, `seo_overview`), not in the browser. Details saved, booked, prep answered and "qualified" are read from the real `leads` rows (qualified = hot or warm and not disqualified), never from client events.
- Each lead is credited to the **first** tracker session that carried it. The reminder email reopens `/book` in a new tab (a new session), so without this the same lead would be counted twice. Those return visits are reported under "Reminder follow-up" and are left out of the funnel.
- WhatsApp, phone and email contacts happen outside the site, so they appear only as clicks ("How visitors choose to get in touch"), never as leads. The page flags visits that went that way and did not book: their conversations live in the WhatsApp inbox and call log.
- `sm-gsc-sync` pulls Search Console queries, pages, countries and devices into `seo_*` tables daily. Search pages are joined to the tracker, showing for each page how many organic visits landed there and how many became leads.

**Privacy (hybrid consent)**

- Always: anonymous sessions. No IP address is stored, no persistent ID is set (the session id lives in `sessionStorage`), and query strings other than `utm_*` are never sent.
- Only after the visitor clicks **Accept** on the cookie banner: a random visitor id is stored to recognise returning visitors. Reject, Do Not Track or Global Privacy Control removes it.
- Update the cookie section of the privacy policy at `sdfmgroup.com/privacy-policy.html` to mention first-party analytics.
- If the marketing site has its own cookie banner, make it store consent as `localStorage.sdfm_cookie_consent = 'accepted' | 'rejected'`, or call `window.sdfm.setConsent('accepted' | 'rejected')`. Without a banner there, the marketing site is tracked anonymously only.

**Setup (in this order)**

1. **Database first.** In the Supabase SQL Editor run, in order and each safe to re-run: `supabase/migration-website-analytics.sql`, then (after the booking flow migrations below) `migration-booking-flow-analytics.sql`, then `migration-website-analytics-booking-journey.sql`. The app tolerates the last one not having run yet: the booking-journey sections stay hidden and a note says so.
2. **Deploy the app.** Netlify serves `/sdfm-tracker.js` with the rest of the app, and `sdfmgroup.com` loads it from there.
3. **Install on the marketing site.** Open Website Analytics → **Install tracker** and paste the snippet before `</head>` on every page of sdfmgroup.com.
4. **Exclude your own traffic.** On each browser used by staff, open any tracked page once with `?sdfm_ignore=1` (for example `https://sdfmgroup.com/?sdfm_ignore=1`). `?sdfm_ignore=0` turns tracking back on.
5. **Search Console (SEO tab).**
   1. In Google Cloud, enable the **Google Search Console API**, create a **service account** and download a JSON key. (A service account is used instead of OAuth: no consent screen, and no refresh token that expires.)
   2. In Search Console → Settings → Users and permissions, add the service account's email (`client_email` in the key) as a user. **Restricted** is enough.
   3. Set the secret. The key may be pasted as JSON or base64 (base64 avoids newline problems in shells). In PowerShell: `supabase secrets set GSC_SERVICE_ACCOUNT_JSON=([Convert]::ToBase64String([IO.File]::ReadAllBytes("key.json")))`
   4. `supabase functions deploy sm-gsc-sync`
   5. In **Settings → Integrations → Google Search Console**, enter the property exactly as Search Console lists it (`sc-domain:sdfmgroup.com` or `https://sdfmgroup.com/`) and press **Verify access**.
   6. In Website Analytics → Search (SEO), press **Sync now**. The first sync backfills 90 days; later syncs refresh the last 7.
   7. Replace `YOUR_PROJECT_URL` / `YOUR_ANON_KEY` in `supabase/migration-website-analytics-cron.sql` and run it to schedule the daily sync and a weekly purge of raw tracking data older than 760 days.

Search Console data lags about two days, and Google omits very rare queries, so query rows add up to slightly less than the site totals.

## Running Locally

```bash
npm install
npm run dev
```

## Environment Variables

Copy `.env.example` to `.env` and add your Supabase credentials:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

## Deployment

Hosted on Netlify with auto-deploy from the `main` branch. Environment variables must be set in Netlify dashboard under Site settings → Environment variables.

## Booking flow (sdfmgroup.com/book)

The public booking form lives on the marketing site, not in this app. Visitors go
**details → pick a time → confirmed**, then optionally answer five prep questions.
Everyone who picks a time is confirmed; the prep answers only score the lead
(hot / warm / cold) for the team. A lead is saved as soon as the contact step is
submitted (stage `Incomplete`) so abandoned bookings can be followed up.

The browser never reads or writes the database. It calls Edge Functions that run
with the service role: `booking-info`, `booking-start`, `booking-confirm`,
`booking-prep`, plus `send-booking-nudges` (cron). Shared logic is in
`supabase/functions/_shared/booking.ts` (its scoring mirrors `src/lib/scoring.js`).

Deploy order:
1. `migration-booking-flow.sql`, then `migration-booking-flow-analytics.sql`
2. `supabase functions deploy booking-info booking-start booking-confirm booking-prep send-booking-nudges`
3. Deploy sdfmgroup.com (cac-website) and this app (`/intake` now 301s to `/book`)
4. Settings → Booking & availability: set the Google Meet link; check the two new templates on Notifications
5. `migration-booking-nudges-cron.sql` (fill in project URL and anon key)
6. **Last:** `migration-booking-lockdown.sql` — removes anonymous access to leads,
   booked slots, availability and settings
7. `migration-leads-update-restrict.sql` — only admin and sales may update leads
   (replaces a hand-made `auth_update_leads` policy that allowed any signed-in user)
