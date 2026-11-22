// Minimal OAuth 2.1 authorization server for the Claude connector (MCP).
// Authorization code + PKCE (S256), dynamic client registration, rotating
// refresh tokens. People approve on the BMS page /oauth/authorize while
// signed in with their normal BMS login; Claude then acts as that person.
// Tokens are random strings; only their SHA-256 hashes are stored.

// deno-lint-ignore no-explicit-any
type Db = any

export const ACCESS_TTL_S = 60 * 60          // 1 hour
export const REFRESH_TTL_S = 60 * 86400      // 60 days
const CODE_TTL_MS = 10 * 60 * 1000

export function publicBase() {
  return (Deno.env.get('BMS_PUBLIC_URL') || 'https://spm.sdfmgroup.com').replace(/\/$/, '')
}

export function authServerMetadata() {
  const base = publicBase()
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['bms'],
  }
}

export function protectedResourceMetadata() {
  const base = publicBase()
  return {
    resource: `${base}/mcp`,
    authorization_servers: [base],
    scopes_supported: ['bms'],
    bearer_methods_supported: ['header'],
    resource_name: 'SDFM BMS',
  }
}

function b64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function randomToken(bytes = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

export async function sha256(text: string) {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))))
}

export class OAuthError extends Error {
  code: string
  status: number
  constructor(code: string, description: string, status = 400) { super(description); this.code = code; this.status = status }
}

function validRedirect(uri: string) {
  try {
    const u = new URL(uri)
    return u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))
  } catch { return false }
}

// RFC 7591 dynamic client registration (public clients, PKCE).
// deno-lint-ignore no-explicit-any
export async function registerClient(db: Db, body: any) {
  const uris: string[] = Array.isArray(body?.redirect_uris) ? body.redirect_uris.map(String) : []
  if (!uris.length || uris.some((u) => !validRedirect(u))) throw new OAuthError('invalid_redirect_uri', 'redirect_uris must be https URLs')
  const client_id = `bms_${randomToken(16)}`
  const client_name = String(body?.client_name || 'Claude').slice(0, 100)
  const { error } = await db.from('mcp_oauth_clients').insert({ client_id, client_name, redirect_uris: uris })
  if (error) throw new OAuthError('server_error', error.message, 500)
  return {
    client_id, client_name, redirect_uris: uris,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  }
}

export async function getClient(db: Db, clientId: string) {
  const { data } = await db.from('mcp_oauth_clients').select('*').eq('client_id', clientId).maybeSingle()
  return data as { client_id: string; client_name: string; redirect_uris: string[] } | null
}

// Called by the BMS consent page (with the signed-in user's id) on Allow.
export async function approve(db: Db, userId: string, p: Record<string, string>) {
  const client = await getClient(db, p.client_id)
  if (!client) throw new OAuthError('invalid_client', 'Unknown client — remove the connector in Claude and add it again')
  if (!client.redirect_uris.includes(p.redirect_uri)) throw new OAuthError('invalid_request', 'redirect_uri is not registered for this client')
  if (p.code_challenge_method !== 'S256' || !p.code_challenge) throw new OAuthError('invalid_request', 'PKCE (S256) is required')
  const code = randomToken(32)
  const { error } = await db.from('mcp_oauth_codes').insert({
    code_hash: await sha256(code), client_id: client.client_id, user_id: userId, redirect_uri: p.redirect_uri,
    code_challenge: p.code_challenge, scope: p.scope || 'bms', resource: p.resource || null,
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  })
  if (error) throw new OAuthError('server_error', error.message, 500)
  const url = new URL(p.redirect_uri)
  url.searchParams.set('code', code)
  if (p.state) url.searchParams.set('state', p.state)
  url.searchParams.set('iss', publicBase())
  return url.toString()
}

async function issueTokens(db: Db, clientId: string, userId: string, scope: string) {
  const access = randomToken(32)
  const refresh = randomToken(32)
  const now = Date.now()
  const { error } = await db.from('mcp_oauth_tokens').insert([
    { token_hash: await sha256(access), kind: 'access', client_id: clientId, user_id: userId, scope, expires_at: new Date(now + ACCESS_TTL_S * 1000).toISOString() },
    { token_hash: await sha256(refresh), kind: 'refresh', client_id: clientId, user_id: userId, scope, expires_at: new Date(now + REFRESH_TTL_S * 1000).toISOString() },
  ])
  if (error) throw new OAuthError('server_error', error.message, 500)
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope }
}

// Token endpoint: authorization_code (with PKCE) and refresh_token (rotating).
export async function token(db: Db, p: Record<string, string>) {
  if (p.grant_type === 'authorization_code') {
    if (!p.code || !p.code_verifier) throw new OAuthError('invalid_request', 'code and code_verifier are required')
    const { data: row } = await db.from('mcp_oauth_codes').select('*').eq('code_hash', await sha256(p.code)).maybeSingle()
    if (!row || row.used_at || new Date(row.expires_at) < new Date()) throw new OAuthError('invalid_grant', 'The code is invalid, used or expired')
    if (p.client_id && p.client_id !== row.client_id) throw new OAuthError('invalid_grant', 'Client mismatch')
    if (p.redirect_uri && p.redirect_uri !== row.redirect_uri) throw new OAuthError('invalid_grant', 'redirect_uri mismatch')
    if ((await sha256(p.code_verifier)) !== row.code_challenge) throw new OAuthError('invalid_grant', 'PKCE verification failed')
    const { data: claimed } = await db.from('mcp_oauth_codes').update({ used_at: new Date().toISOString() }).eq('code_hash', row.code_hash).is('used_at', null).select('code_hash')
    if (!claimed?.length) throw new OAuthError('invalid_grant', 'The code was already used')
    return await issueTokens(db, row.client_id, row.user_id, row.scope || 'bms')
  }
  if (p.grant_type === 'refresh_token') {
    if (!p.refresh_token) throw new OAuthError('invalid_request', 'refresh_token is required')
    const hash = await sha256(p.refresh_token)
    const { data: row } = await db.from('mcp_oauth_tokens').select('*').eq('token_hash', hash).eq('kind', 'refresh').maybeSingle()
    if (!row || row.revoked_at || new Date(row.expires_at) < new Date()) throw new OAuthError('invalid_grant', 'The refresh token is invalid or expired')
    if (p.client_id && p.client_id !== row.client_id) throw new OAuthError('invalid_grant', 'Client mismatch')
    await db.from('mcp_oauth_tokens').update({ revoked_at: new Date().toISOString() }).eq('token_hash', hash)
    return await issueTokens(db, row.client_id, row.user_id, row.scope || 'bms')
  }
  throw new OAuthError('unsupported_grant_type', 'Only authorization_code and refresh_token are supported')
}

export async function revoke(db: Db, tokenValue: string) {
  if (tokenValue) await db.from('mcp_oauth_tokens').update({ revoked_at: new Date().toISOString() }).eq('token_hash', await sha256(tokenValue))
}

// Bearer token on an MCP request → the BMS user, or null.
export async function userFromAccessToken(db: Db, bearer: string | null) {
  if (!bearer) return null
  const hash = await sha256(bearer)
  const { data: row } = await db.from('mcp_oauth_tokens').select('user_id, expires_at, revoked_at, last_used_at').eq('token_hash', hash).eq('kind', 'access').maybeSingle()
  if (!row || row.revoked_at || new Date(row.expires_at) < new Date()) return null
  const { data: profile } = await db.from('profiles').select('id, name, email, role, is_active').eq('id', row.user_id).maybeSingle()
  if (!profile || profile.is_active === false) return null
  if (!row.last_used_at || Date.now() - new Date(row.last_used_at).getTime() > 5 * 60 * 1000) {
    await db.from('mcp_oauth_tokens').update({ last_used_at: new Date().toISOString() }).eq('token_hash', hash)
  }
  return profile as { id: string; name: string; email: string; role: string }
}
