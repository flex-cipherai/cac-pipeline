# SDFM Sales Management Pipeline

Business management system for SDFM Group Limited. Manages the full sales lifecycle from lead intake through contract signing, plus LinkedIn social media management (composer, calendar, bulk scheduling, approvals, analytics, activity inbox) under `/social/*` — see `SDFM Social Media Management System Description.pdf` for the module spec. Both modules share the same Supabase project, roles (`admin`, `sales`, `marketing`), and deploy pipeline.

## Tech Stack

- **Frontend:** React (Vite)
- **Backend:** Supabase (PostgreSQL, Auth, RLS)
- **Deployment:** Netlify
- **Styling:** Plain CSS (SDFM Brand Guidelines)

## Structure

```
cac-pipeline/
├── public/              # Static assets
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
│   └── functions/sm-*/          # Social media Edge Functions
├── .env                 # Environment variables (not committed)
├── netlify.toml         # Netlify SPA routing config
└── vite.config.js       # Vite configuration
```

Run the `migration-social-*.sql` files (in that order) in the Supabase SQL Editor after `schema.sql`, deploy the `sm-*` Edge Functions, and set `app_base_url` in Settings → Content Defaults once the site is live, to enable the Social Media Management module.

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
