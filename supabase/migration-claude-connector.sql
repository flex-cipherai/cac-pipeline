-- ============================================================
-- Claude connector (MCP) — OAuth storage
--
-- Lets people add the BMS to Claude (claude.ai → Settings → Connectors) and
-- act through it as themselves. The bms-mcp Edge Function is both the MCP
-- server and a small OAuth 2.1 authorization server:
--   mcp_oauth_clients — clients registered by Claude (dynamic registration)
--   mcp_oauth_codes   — one-time authorization codes (10 minutes, PKCE)
--   mcp_oauth_tokens  — access (1 hour) and refresh (60 days, rotating)
--                       tokens, stored only as SHA-256 hashes
-- All three are service-role only: RLS on, no policies.
--
-- Safe to run more than once.
-- ============================================================

create table if not exists public.mcp_oauth_clients (
  client_id text primary key,
  client_name text,
  redirect_uris text[] not null,
  created_at timestamptz not null default now()
);
alter table public.mcp_oauth_clients enable row level security;

create table if not exists public.mcp_oauth_codes (
  code_hash text primary key,
  client_id text not null references public.mcp_oauth_clients(client_id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  scope text,
  resource text,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.mcp_oauth_codes enable row level security;

create table if not exists public.mcp_oauth_tokens (
  token_hash text primary key,
  kind text not null check (kind in ('access', 'refresh')),
  client_id text not null references public.mcp_oauth_clients(client_id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  scope text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.mcp_oauth_tokens enable row level security;

create index if not exists mcp_oauth_tokens_user_idx on public.mcp_oauth_tokens (user_id, kind);

-- What each person can see about their own Claude connections (Settings →
-- My profile), without exposing token hashes.
create or replace function public.my_claude_connections()
returns table (client_name text, connected_at timestamptz, last_used_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select c.client_name, min(t.created_at), max(t.last_used_at)
  from public.mcp_oauth_tokens t
  join public.mcp_oauth_clients c on c.client_id = t.client_id
  where t.user_id = auth.uid() and t.revoked_at is null and t.expires_at > now()
  group by c.client_name;
$$;

create or replace function public.revoke_my_claude_connections()
returns integer
language sql
security definer
set search_path = public
as $$
  with r as (
    update public.mcp_oauth_tokens set revoked_at = now()
    where user_id = auth.uid() and revoked_at is null
    returning 1
  )
  select count(*)::int from r;
$$;

revoke all on function public.my_claude_connections() from public, anon;
revoke all on function public.revoke_my_claude_connections() from public, anon;
grant execute on function public.my_claude_connections() to authenticated;
grant execute on function public.revoke_my_claude_connections() to authenticated;
