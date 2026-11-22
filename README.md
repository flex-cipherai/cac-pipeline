# SDFM Business Management Solution

Business management system for SDFM Group Limited. Manages the full sales lifecycle from lead intake through contract signing, plus Metricool-style social media management under `/social/*` (Planner, multi-network composer, queues and autolists, Analytics, Inbox with replies, scheduled Reports, Link in Bio), built to take any network: LinkedIn, Facebook and Instagram are live; TikTok / X / YouTube plug in as connectors — see `SDFM Social Media Management System Description.pdf` for the module spec. Both modules share the same Supabase project, roles (`admin`, `sales`, `marketing`), and deploy pipeline.

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
│   ├── migration-social-linkedin-oauth.sql # LinkedIn OAuth token storage
│   ├── migration-social-linkedin-publishing.sql # Automated Mode: profile accounts, publish state, synced comments
│   ├── migration-social-linkedin-sync-cron.sql # pg_cron: hourly LinkedIn analytics + comment sync
│   ├── migration-website-analytics.sql     # Website analytics: sessions/events, funnel + SEO reports
│   ├── migration-website-analytics-cron.sql # pg_cron: daily Search Console sync, data retention
│   ├── migration-role-permissions.sql      # Settings → Permissions: which modules each role can open
│   ├── migration-permissions-enforcement.sql # Makes every module's database policies follow that table
│   ├── migration-inquiries.sql             # Inquiries: tables, RLS, convert_inquiry_to_lead()
│   ├── migration-inquiry-reminders.sql     # Inquiry reminder columns + email templates
│   ├── migration-inquiry-reminders-cron.sql # pg_cron: daily digest + hourly reply alerts
│   ├── migration-ospod-waitlist.sql        # Ospod waitlist signups: table, numbering function, RLS, permission seed
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
- **Abuse limits.** Honeypot and minimum fill time, 5 starts per hour per network, 3 per email per day, no overall daily cap on sessions (one assessment makes about 14 model calls, so watch your Gemini plan's requests-per-day limit; when it runs out visitors see the "AI is busy" message), a turn cap per session, a processing lock so two taps cannot run two model calls, work email required (free and disposable domains rejected, MX checked), and website fetching only to public hosts (every redirect re-checked).
- **Privacy.** On Gemini's free tier Google may use prompts to improve its products and have humans review them. The consent text and the privacy policy (`#ai-gap-check`) say answers go to Google Gemini; switching the API key's project to a paid plan removes that. Do that before promoting the tool widely.
- **Setup (in order):** run `migration-gap-assessments.sql` (after `migration-inquiries.sql` and `migration-role-permissions.sql`; it also widens the `inquiries.offer` check, as `migration-website-leads.sql` now does); `supabase secrets set GEMINI_API_KEY=...` (Google AI Studio; `RESEND_API_KEY` and `SENDER_EMAIL` are the existing ones); `supabase functions deploy gap-assessment --no-verify-jwt`; then deploy the website. Open Settings → Automation scoper and check the two model names exist on your plan.

### Ospod Waitlist (`/ospod-waitlist`)

Ospod is a separate product SDFM is testing demand for with a waitlist (landing pages live in their own repo, `flex-cipherai/ospod`: React, on Netlify). This module is where the signups land. Sidebar group **Ospod**; admin only until you switch the module on for a role in Settings → Permissions.

- **What is saved.** One row per email in `ospod_waitlist_signups`: email, which page (`indie` for the Instagram page, `studios` for the LinkedIn page), the four answers (who they are, shows, episodes a month, editing spend), where they came from (`utm_*` and referrer; `utm_content` carries the ad variant: `ig_30`, `ig_15`, `li_30`, `li_15`), a salted hash of their network address (never the address), a follow-up status and notes. A repeat signup keeps the first answers and the first source.
- **Founding 500.** `member_no` is the join order. `ospod_waitlist_join()` numbers people under a lock (no gaps, no duplicates, the cap holds under simultaneous signups); #1 to #500 are founding members. The page's meter reads the real count through the Edge Function (`GET`).
- **Every signup emails the team.** The `ospod-waitlist` Edge Function sends the alert to everyone with the `ospod_waitlist` module (inactive accounts left out), via the same Resend secrets as the other functions. The email is best effort: if it fails the signup is still saved, and the row's `notified_at` stays empty so you can see it. Reply-to is the person who signed up.
- **The page** shows totals, a breakdown by ad tag, by who they are and by editing spend (so you can judge cost per qualified signup by segment), status tabs, search, CSV export and a drawer with the answers, status and notes. Staff can change status and notes only; an admin can delete a row (for "delete my data" requests).
- **Abuse limits.** Hidden honeypot field, minimum fill time, 8 accepted requests per hour per network, answers checked against the lists on the page, free text stripped of control characters and escaped in the email. CORS allows `https://ospod.sdfmgroup.com` plus anything in the `OSPOD_ALLOWED_ORIGINS` secret; `*.netlify.app` is allowed until you set `OSPOD_ALLOW_NETLIFY=false`.
- **Setup (in order):** run `migration-ospod-waitlist.sql` (after `migration-role-permissions.sql`; the rate limit reuses `booking_attempts` from `migration-booking-flow.sql`); `supabase functions deploy ospod-waitlist --no-verify-jwt`; optionally `supabase secrets set OSPOD_ALLOWED_ORIGINS=https://your-final-domain`; then deploy the CRM. The allowed answers live in `functions/_shared/ospodWaitlist.ts` and must match the chips in the landing page's `src/components/Shared.jsx`.
- **To change an answer's wording:** change it in both places (page and `ospodWaitlist.ts`). Old rows keep the old wording; the database does not constrain the answers.

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

### Social Media Management (`/social/*`)

Benchmarked on Metricool. Sidebar: **Planner · Analytics · Inbox · Reports · Link in Bio · Library · Website Analytics**. Every page has the same **account bar** (all connected accounts, multi-select, remembered per browser).

- **Planner** (`/social/calendar`, `Planner.jsx`): week grid by hour (best-time shading, free queue slots as dashed placeholders, drag to reschedule, click an empty hour to compose), month and list views, and a to-do panel (Failed → Retry / Post manually, Ready to post, Drafts). **Posting schedule** (queue time slots per account, `posting_slots`, "Suggest best times") and **Autolists** (evergreen rotation) open from here, as do Bulk import and Approvals.
- **Composer** (`ContentComposer.jsx`): pick several accounts; one `posts` row per account sharing `post_group_id`. Shared text with per-account overrides, per-network live preview (`components/PostPreview`) and checks against each platform's limits (`src/lib/platforms.js`), first comment, poll, media, UTM link, pillar/campaign. Actions: Schedule · Add to queue (next free slot per account) · Publish now · Save draft · Submit for approval (when approvals are on, for non-admins) · Save as template · Add to autolist. "Repeat this post" sets `posts.recurrence`; the engine creates the next occurrence when a post leaves the schedule.
- **Autolists**: `autolists` (accounts, weekly slots, avoid-repeat days) + `autolist_items` (template posts). `sm-autolists` (hourly) keeps the next 7 days filled.
- **Best times**: view `social_best_times` (avg engagement rate by account × weekday × hour from published posts). Under 10 posts the UI shows each platform's industry defaults, labelled as such.
- **Analytics** (`SocialAnalytics.jsx`): range presets with comparison to the previous period; followers, impressions, engagements, rate, clicks, posts; trend chart; best-time heatmap; pipeline attribution and campaign goals; top posts (sortable, drill-down); "What performs" by format / pillar / campaign / weekday / account; CSV, PDF, manual logging and CSV import.
- **Inbox** (`/social/activity`, `Inbox.jsx`): synced comments grouped per post, threaded; **Reply** posts on the network as the account (`sm-reply` → connector `replyToComment`), stored as an outbound `activity_events` row; Done / Ignore / Reopen; manual logging for what can't sync.
- **Reports** (`Reports.jsx`): `report_schedules` (weekly on a weekday, or monthly on the 1st; accounts; recipients — empty = everyone with Reports access; sections). `sm-reports` (daily 04:00 UTC) emails a branded HTML report vs the previous period; "Send now" on the page. Replaces `sm-weekly-digest`.
- **Link in Bio** (`LinkInBio.jsx`): `bio_pages` + `bio_links`; editor with live phone preview; public page `/l/<slug>` (`pages/public/BioPage.jsx`, no login) served by the `bio-page` Edge Function, which also counts views and clicks and redirects (adding `utm_source=linkinbio` when enabled). The tables are never readable anonymously.
- **Permissions**: existing keys kept (calendar = Planner, activity = Inbox; composer, bulk import and approvals open from the Planner) plus `social_reports` and `social_links`.

**Adding a network** (Meta, TikTok, X, YouTube): write `supabase/functions/_shared/platforms/<platform>.ts` implementing `Connector` (`platforms/types.ts`: publish, first comment, post stats, followers, comments, reply), register it in `platforms/index.ts`, add `sm-<platform>-oauth-start/-callback` that create `connected_accounts` rows (`platform`, `account_type`, `external_page_id`) and store tokens in `connected_account_tokens`, then set its `status` to `'live'` in `src/lib/platforms.js`. The publishing engine (`_shared/publisher.ts`), sync (`_shared/socialSync.ts`), inbox, analytics and UI need no change.

Setup order: `migration-social-v2.sql` → deploy `sm-move-to-ready`, `sm-publish`, `sm-sync`, `sm-linkedin-sync`, `sm-autolists`, `sm-reports`, `bio-page` (cron/public ones with `--no-verify-jwt`), `sm-reply`, `sm-linkedin-oauth-start`, `sm-linkedin-oauth-callback --no-verify-jwt`, `sm-linkedin-pages` → `migration-social-v2-cron.sql` (project URL + anon key) → reconnect LinkedIn once (new comment scopes).

### Meta — Facebook Pages & Instagram

- **Connect:** Settings → Integrations → **Connect Meta** (`sm-meta-oauth-start` → Facebook Login → `sm-meta-oauth-callback`, deployed with `--no-verify-jwt`). Every Facebook Page the person manages, and each Page's linked Instagram professional account, is saved as a `connected_accounts` row (`facebook`/`page`, `instagram`/`business`) with the Page token (non-expiring) in `connected_account_tokens`. New accounts start unmanaged unless none of that network is managed yet; choose with **Manage in BMS**.
- **Secrets:** `META_APP_ID`, `META_APP_SECRET`, and `META_LOGIN_CONFIG_ID` (Facebook Login for Business configuration; without it the scopes in `_shared/meta.ts` are requested directly). Redirect URI on the Meta app: `https://<project-ref>.supabase.co/functions/v1/sm-meta-oauth-callback`. The app is Live; permissions are Standard Access, so only people with a role on the Meta app can connect (no App Review needed for SDFM's own Pages).
- **Connectors:** `_shared/platforms/facebook.ts` (text, photo, multi-photo, video; first comment; comments and threaded replies; post and Page insights; past posts) and `instagram.ts` (single image, carousel of 2–10 images, video as a Reel; container → publish, videos wait while Instagram processes them; JPEG only, 30 hashtags max; comments and replies; insights; past posts). Media is passed to Meta as short-lived signed Content Library links. Meta retires insight metric names over time; each metric is tried by name with fallbacks, and `META_GRAPH_VERSION` in `_shared/meta.ts` should be bumped before it is retired.
- **Instagram connects with its own sign-in** (Instagram API with *Unified login*): Integrations → **Connect Instagram** (`sm-instagram-oauth-start` → Meta dialog with the Instagram-Login-compatible configuration → back to the already-registered `sm-meta-oauth-callback`). Uses the Meta app ID/secret plus secret `INSTAGRAM_CONFIG_ID` (the configuration ID shown under the Instagram use case → API setup with Unified login). The callback lists `me/assigned_instagram_accounts`, stores the business system-user token (lifetime set by the configuration; read via `debug_token`), and all Instagram calls use graph.facebook.com. No Facebook Page link and no Instagram app ID are needed. (The older Instagram Login path — `sm-instagram-oauth-callback`, `INSTAGRAM_APP_ID/SECRET`, graph.instagram.com — is still supported in the code but unused.)
- Threads is not used by SDFM (`status: 'off'` in `src/lib/platforms.js`).

### LinkedIn API — Automated Mode (Community Management API)

LinkedIn approved the app for the **Community Management API**. Connecting LinkedIn once (Settings → Integrations → Connect LinkedIn, signed in as an admin of the Company Page) sets up two publishing targets, both in Automated Mode:

- **Company Pages** (`connected_accounts.account_type = 'organization'`, one row per page the connecting person administers, unique on `external_page_id`): Settings → Integrations lists them with **Manage in BMS / Stop managing** (`status` active / disconnected). Only managed pages appear under Post As, publish and sync; a page found for the first time starts unmanaged (unless no page is managed yet). **Refresh pages** (`sm-linkedin-pages`) re-reads the list using the existing connection, no LinkedIn sign-in needed. Managed pages: scheduled posts publish automatically; post analytics, the follower count and new comments sync hourly.
- **The connecting person's own profile** (`account_type = 'member'`, `owner_profile_id` = that BMS user): pick it under **Post As** in the composer. Only the owner can schedule to their profile (database trigger `check_post_account_owner`). Post analytics sync; comments on profile posts do not (that needs `r_member_social_feed`, which LinkedIn does not grant this app).

How it runs:

- **Publishing** — `sm-move-to-ready` (pg_cron, every 5 minutes) publishes due posts whose account is in Automated Mode, and still moves Assisted-Mode posts to Ready to Post. The logic is in `_shared/linkedinPublish.ts`: text, 1–20 images, document/carousel (PDF, PPTX, DOCX), video (MP4, up to 200 MB because the file passes through the Edge Function) and polls (question ≤ 140 characters, 2–4 options of ≤ 30). Media is uploaded once and remembered in `posts.publish_state`; videos and documents wait (status `publishing`) until LinkedIn has processed them, for up to an hour. A failure marks the post `failed` with `publish_error`, and alerts the content team in-app and by email (template `sm_post_failed`). The Content Calendar's **Failed to Publish** panel offers Retry (`sm-publish`) or Post Manually (falls back to Ready to Post).
- **Sync** — `sm-sync` (pg_cron, hourly at :20; also "Sync now" in Integrations; `sm-linkedin-sync` is kept as an alias). `analytics_snapshots` rows are increments, so each sync stores the change since the last pull (`posts.last_stats`), per post and as one account-level row (source `api`). Stats cover posts from the last 90 days, refreshed every 6 hours per post; comments cover Company Page posts from the last 30 days and land in the Activity Inbox (deduplicated by `activity_events.external_id`). Follower milestones are logged and alerted as before.
- **Caption text** is sent in LinkedIn's "little text format": `| { } @ [ ] ( ) < > * _ ~ \` are escaped so they show literally, and `#word` stays a hashtag. Mentions typed in the composer are not converted into LinkedIn mentions.

Setup:

- Secrets: `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` (`supabase secrets set`, never in `.env` or frontend code).
- The LinkedIn app's **Authorized redirect URL**: `https://<project-ref>.supabase.co/functions/v1/sm-linkedin-oauth-callback`.
- Scopes requested (`LINKEDIN_SCOPES` in `_shared/linkedin.ts`) must all be listed on the app's Auth tab, or LinkedIn refuses the connection: `r_basicprofile w_member_social r_member_postAnalytics r_organization_social r_organization_social_feed w_organization_social w_organization_social_feed w_member_social_feed rw_organization_admin` (the two `_feed` write scopes power first comments and inbox replies).
- `LINKEDIN_API_VERSION` (`YYYYMM`) in the same file: each version lasts about a year; bump it before it sunsets.
- Order: `migration-social-linkedin-oauth.sql` → `migration-social-linkedin-publishing.sql` → deploy `sm-publish`, `sm-linkedin-pages`, `sm-move-to-ready --no-verify-jwt`, `sm-linkedin-sync --no-verify-jwt`, `sm-linkedin-oauth-start`, `sm-linkedin-oauth-callback --no-verify-jwt` → `migration-social-linkedin-sync-cron.sql` (fill in the project URL and anon key) → Connect LinkedIn in Settings.
- Access tokens last 60 days. If LinkedIn issues a refresh token it is used automatically; otherwise publishing fails with "reconnect LinkedIn" when it expires, so reconnect every ~2 months.

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

The public booking form lives on the marketing site, not in this app. Visitors enter
their name, email, company and a short description of their problem, pick a time (shown in
their own time zone) and are confirmed. The confirmation email carries an add-to-Google-Calendar
link and an invite.ics attachment, and every admin/sales user with the Pipeline module gets a
"New call booked" email. Both emails are built in `_shared/bookingEmail.ts` (they no longer use the
editable templates). There are no prep questions or phone field any more, so new leads stay
`unscored`; the `booking-prep` function has been removed. A lead is saved as soon as the
contact step is submitted (stage `Incomplete`) so abandoned bookings can be followed up.

The browser never reads or writes the database. It calls Edge Functions that run
with the service role: `booking-info`, `booking-start`, `booking-confirm`,
plus `send-booking-nudges` (cron). Shared logic is in
`supabase/functions/_shared/booking.ts` (its scoring mirrors `src/lib/scoring.js`).

Deploy order:
1. `migration-booking-flow.sql`, then `migration-booking-flow-analytics.sql`
2. `supabase functions deploy booking-info booking-start booking-confirm send-booking-nudges`
3. Deploy sdfmgroup.com (cac-website) and this app (`/intake` now 301s to `/book`)
4. Settings → Booking & availability: set the Google Meet link; check the two new templates on Notifications
5. `migration-booking-nudges-cron.sql` (fill in project URL and anon key)
6. **Last:** `migration-booking-lockdown.sql` — removes anonymous access to leads,
   booked slots, availability and settings
7. `migration-leads-update-restrict.sql` — only admin and sales may update leads
   (replaces a hand-made `auth_update_leads` policy that allowed any signed-in user)
