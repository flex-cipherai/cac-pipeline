# CAC Sales Pipeline Management System

Sales pipeline management system for Cipher AI Consultants. Manages the full sales lifecycle from lead intake through contract signing.

## Tech Stack

- **Frontend:** React (Vite)
- **Backend:** Supabase (PostgreSQL, Auth, RLS)
- **Deployment:** Netlify
- **Styling:** Plain CSS (CAC Brand Guidelines)

## Structure

```
cac-pipeline/
├── public/              # Static assets
├── src/
│   ├── components/      # Reusable components
│   │   └── Layout/      # Sidebar and layout
│   ├── pages/           # Route pages
│   ├── lib/             # Supabase client, scoring logic, auth
│   └── styles/          # Global CSS and variables
├── supabase/
│   └── schema.sql       # Database schema
├── .env                 # Environment variables (not committed)
├── netlify.toml         # Netlify SPA routing config
└── vite.config.js       # Vite configuration
```

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
