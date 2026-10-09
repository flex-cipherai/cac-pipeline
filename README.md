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
│   └── functions/sm-*/          # Social media Edge Functions (incl. sm-gsc-sync)
├── .env                 # Environment variables (not committed)
├── netlify.toml         # Netlify SPA routing config
└── vite.config.js       # Vite configuration
```

Run the `migration-social-*.sql` files (in that order) in the Supabase SQL Editor after `schema.sql`, deploy the `sm-*` Edge Functions, and set `app_base_url` in Settings → Content Defaults once the site is live, to enable the Social Media Management module.

### Phase 2 — LinkedIn API (Community Management API)

Assisted Mode (manual copy/paste publishing, manual analytics entry) works with zero LinkedIn API access — see the module description PDF. Phase 2 adds direct API publishing once LinkedIn approves the app for the **Community Management API** product (a reviewed application at developer.linkedin.com, distinct from and much lighter-weight than the ads-focused Marketing Developer Platform).

- `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` — set as Supabase Edge Function secrets (`supabase secrets set`), never in `.env` or frontend code.
- `supabase/migration-social-linkedin-oauth.sql` — adds `connected_account_tokens` (access/refresh tokens, service-role only, no RLS policies granted to any client role) and `oauth_states` (CSRF protection for the OAuth handshake).
- `sm-linkedin-oauth-start` — admin-only, called from Settings → Connected Accounts ("Connect LinkedIn"); returns the LinkedIn authorization URL.
- `sm-linkedin-oauth-callback` — deployed with `--no-verify-jwt` since LinkedIn's browser redirect hits it directly (no Supabase session). Exchanges the code for tokens, resolves the administered LinkedIn Organization (requires `rw_organization_admin`, only grantable post-approval), and redirects back to `/settings`.
- The LinkedIn app's **Authorized redirect URL** must be set to `https://<project-ref>.supabase.co/functions/v1/sm-linkedin-oauth-callback` — not the app's own domain, since only the Edge Function can hold the Client Secret for the token exchange.
- `connected_accounts.mode` flips to `automated` automatically once an Organization is resolved; until LinkedIn approves the API product, the account can be OAuth-connected but stays in Assisted Mode (`oauth_connected = true`, `mode = 'assisted'`) — no manual toggle needed.
- `supabase/functions/_shared/linkedin.ts` has the token exchange/refresh helpers `sm-publish` / `sm-fetch-analytics` / `sm-fetch-activity` will use once built.

### Website Analytics (`/social/website-analytics`)

Answers three questions in one place: **How are people finding us? What are they doing on the website? Are they turning into qualified leads?** It combines first-party website tracking, Lead Intake Form funnel analytics, Google Search Console (SEO) and lead conversion data.

**How it fits together**

- `public/sdfm-tracker.js` is a small first-party script. It runs on the Lead Intake Form automatically and on `sdfmgroup.com` once the snippet is installed. It records pageviews, time on page, scroll depth, link/button clicks (labels only), outbound links, downloads and site form submissions, and sends them in batches to the `track_web_batch` database function.
- When a visitor clicks from the marketing site to the intake form, the tracker carries the session across (`sdfm_sid`), so the lead is credited to how the visit **first** arrived (channel, source, campaign, landing page) rather than to "Website".
- The intake form reports its funnel (opened → started → contact done → qualification done → picked a time → submitted) plus the qualification option each visitor chose. No name, email or phone is ever sent; the lead id is sent only to link the visit to the lead it produced.
- Reports are computed in Postgres (`web_analytics_*`, `seo_overview`), not in the browser. The funnel's final step and "qualified" are read from the real `leads` rows (same definition as Lead Analytics: not cold and not disqualified), never from client events.
- `sm-gsc-sync` pulls Search Console queries, pages, countries and devices into `seo_*` tables daily. Search pages are joined to the tracker, showing for each page how many organic visits landed there and how many became leads.

**Privacy (hybrid consent)**

- Always: anonymous sessions. No IP address is stored, no persistent ID is set (the session id lives in `sessionStorage`), and query strings other than `utm_*` are never sent.
- Only after the visitor clicks **Accept** on the cookie banner: a random visitor id is stored to recognise returning visitors. Reject, Do Not Track or Global Privacy Control removes it.
- Update the cookie section of the privacy policy at `sdfmgroup.com/privacy-policy.html` to mention first-party analytics.
- If the marketing site has its own cookie banner, make it store consent as `localStorage.sdfm_cookie_consent = 'accepted' | 'rejected'`, or call `window.sdfm.setConsent('accepted' | 'rejected')`. Without a banner there, the marketing site is tracked anonymously only.

**Setup (in this order)**

1. **Database first.** Run `supabase/migration-website-analytics.sql` in the Supabase SQL Editor (safe to re-run) *before* deploying the frontend that loads the tracker.
2. **Deploy the app.** Netlify serves `/sdfm-tracker.js` with the rest of the app. The Lead Intake Form is tracked from this point.
3. **Install on the marketing site.** Open Website Analytics → **Install tracker** and paste the snippet before `</head>` on every page of sdfmgroup.com.
4. **Exclude your own traffic.** On each browser used by staff, open any tracked page once with `?sdfm_ignore=1` (for example `https://sdfmgroup.com/?sdfm_ignore=1`). `?sdfm_ignore=0` turns tracking back on.
5. **Search Console (SEO tab).**
   1. In Google Cloud, enable the **Google Search Console API**, create a **service account** and download a JSON key. (A service account is used instead of OAuth: no consent screen, and no refresh token that expires.)
   2. In Search Console → Settings → Users and permissions, add the service account's email (`client_email` in the key) as a user. **Restricted** is enough.
   3. Set the secret. The key may be pasted as JSON or base64 (base64 avoids newline problems in shells). In PowerShell: `supabase secrets set GSC_SERVICE_ACCOUNT_JSON=([Convert]::ToBase64String([IO.File]::ReadAllBytes("key.json")))`
   4. `supabase functions deploy sm-gsc-sync`
   5. In **Settings → Connected Accounts → Google Search Console**, enter the property exactly as Search Console lists it (`sc-domain:sdfmgroup.com` or `https://sdfmgroup.com/`) and press **Verify access**.
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
4. Settings → set the Google Meet link; check the two new templates on Notifications
5. `migration-booking-nudges-cron.sql` (fill in project URL and anon key)
6. **Last:** `migration-booking-lockdown.sql` — removes anonymous access to leads,
   booked slots, availability and settings
