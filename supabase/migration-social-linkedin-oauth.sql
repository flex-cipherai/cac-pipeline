-- Phase 2: LinkedIn OAuth (Community Management API)
-- Adds token storage for the connected LinkedIn account and a short-lived
-- state table for CSRF protection during the OAuth handshake.
--
-- Security: both tables have RLS enabled with NO policies granted to
-- 'authenticated' or 'anon' — only the service-role key (used exclusively by
-- the sm-linkedin-oauth-* Edge Functions) can read or write them. Access and
-- refresh tokens must never be reachable from the browser client, even for
-- admins, since the frontend only ever holds the anon key.

-- 0. Non-secret status flag the frontend can safely read (RLS on
-- connected_accounts already restricts it to admin/marketing) — lets
-- Settings show "linked, awaiting API approval" without ever querying the
-- token table itself.
alter table public.connected_accounts
  add column if not exists oauth_connected boolean not null default false;

-- 1. OAuth tokens for the connected LinkedIn account
create table if not exists public.connected_account_tokens (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null unique references public.connected_accounts(id) on delete cascade,
  access_token text not null,
  refresh_token text,
  token_expires_at timestamptz not null,
  refresh_token_expires_at timestamptz,
  scope text,
  linkedin_member_urn text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.connected_account_tokens enable row level security;

create trigger on_connected_account_tokens_updated
  before update on public.connected_account_tokens
  for each row execute function public.handle_updated_at();

-- 2. Short-lived OAuth state (CSRF protection + carries the frontend origin
-- to redirect back to, since the callback is hit by LinkedIn's browser
-- redirect directly, not by an authenticated app request)
create table if not exists public.oauth_states (
  id uuid primary key default gen_random_uuid(),
  state text not null unique,
  provider text not null default 'linkedin',
  user_id uuid references public.profiles(id) on delete cascade,
  redirect_origin text not null,
  created_at timestamptz default now()
);

alter table public.oauth_states enable row level security;

create index if not exists idx_oauth_states_state on public.oauth_states(state);
