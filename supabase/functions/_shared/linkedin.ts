// Shared helpers for the LinkedIn Community Management API.
// Used by sm-linkedin-oauth-start / -callback (connecting), sm-publish and
// sm-move-to-ready (publishing) and sm-linkedin-sync (analytics + comments).

// LinkedIn-Version header (YYYYMM). Each version is supported for at least a
// year; bump it before it sunsets (see LinkedIn's "Recent changes" page).
export const LINKEDIN_API_VERSION = '202610'

export const LINKEDIN_AUTH_BASE = 'https://www.linkedin.com/oauth/v2'
export const LINKEDIN_API_BASE = 'https://api.linkedin.com/rest'

// Must be a subset of the scopes listed on the LinkedIn app's Auth tab —
// asking for one the app was not granted makes LinkedIn refuse the whole
// connection. Organization scopes post to and read the Company Page; member
// scopes post to (and read analytics for) the connecting person's own
// profile. Comments on member posts need r_member_social_feed, which the app
// does not have, so those are not synced (first comments on them still work).
export const LINKEDIN_SCOPES = [
  'r_basicprofile',
  'w_member_social',
  'r_member_postAnalytics',
  'r_organization_social',
  'r_organization_social_feed',
  'w_organization_social',
  'w_organization_social_feed', // first comments + inbox replies as the page
  'w_member_social_feed',       // first comments on profile posts
  'rw_organization_admin',
]

export function buildAuthorizationUrl({ clientId, redirectUri, state }: {
  clientId: string
  redirectUri: string
  state: string
}) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: LINKEDIN_SCOPES.join(' '),
  })
  return `${LINKEDIN_AUTH_BASE}/authorization?${params.toString()}`
}

interface TokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
  refresh_token_expires_in?: number
  scope?: string
}

async function requestToken(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${LINKEDIN_AUTH_BASE}/accessToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(data.error_description || data.error || `LinkedIn token request failed (${res.status})`)
  }
  return data
}

export function exchangeCodeForToken({ code, redirectUri, clientId, clientSecret }: {
  code: string
  redirectUri: string
  clientId: string
  clientSecret: string
}) {
  return requestToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  })
}

export function refreshAccessToken({ refreshToken, clientId, clientSecret }: {
  refreshToken: string
  clientId: string
  clientSecret: string
}) {
  return requestToken({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  })
}

// Token columns to store for a fresh or refreshed token response.
export function tokenColumns(token: TokenResponse) {
  const now = Date.now()
  return {
    access_token: token.access_token,
    token_expires_at: new Date(now + token.expires_in * 1000).toISOString(),
    ...(token.refresh_token ? { refresh_token: token.refresh_token } : {}),
    ...(token.refresh_token_expires_in
      ? { refresh_token_expires_at: new Date(now + token.refresh_token_expires_in * 1000).toISOString() }
      : {}),
    ...(token.scope ? { scope: token.scope } : {}),
  }
}

export class LinkedInApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

// Calls the versioned REST API. `path` is relative to /rest (or a full URL).
// Returns the parsed JSON body (or null) plus the response headers.
export async function liFetch(
  accessToken: string,
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ data: any; headers: Headers; status: number }> {
  const url = path.startsWith('http') ? path : `${LINKEDIN_API_BASE}${path}`
  const res = await fetch(url, {
    method: init.method || 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'LinkedIn-Version': LINKEDIN_API_VERSION,
      'X-Restli-Protocol-Version': '2.0.0',
      ...(init.headers || {}),
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  })
  const text = await res.text()
  let data: any = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!res.ok) {
    const detail = (data && typeof data === 'object' && (data.message || data.error_description)) || text || res.statusText
    throw new LinkedInApiError(`LinkedIn ${res.status}: ${String(detail).slice(0, 300)}`, res.status)
  }
  return { data, headers: res.headers, status: res.status }
}

// The connecting member's id and name (needs r_basicprofile). The id is
// what goes into urn:li:person:{id} as a post author.
export async function fetchMe(accessToken: string): Promise<{ id: string; name: string }> {
  const res = await fetch('https://api.linkedin.com/v2/me', {
    headers: { Authorization: `Bearer ${accessToken}`, 'X-Restli-Protocol-Version': '2.0.0' },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.id) {
    throw new Error(`Could not read your LinkedIn profile (${res.status}): ${data.message || 'no id returned'}`)
  }
  const name = [data.localizedFirstName, data.localizedLastName].filter(Boolean).join(' ').trim()
  return { id: data.id, name: name || 'My LinkedIn profile' }
}

// LinkedIn Organizations the connected member administers (rw_organization_admin).
export async function fetchAdministeredOrganizations(accessToken: string): Promise<string[]> {
  const { data } = await liFetch(accessToken, '/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED')
  return (data?.elements || []).map((el: { organization: string }) => el.organization).filter(Boolean)
}

export async function fetchOrganizationName(accessToken: string, orgUrn: string): Promise<string | null> {
  try {
    const id = orgUrn.split(':').pop()
    const { data } = await liFetch(accessToken, `/organizations/${id}`)
    return data?.localizedName || null
  } catch {
    return null
  }
}

// Returns a valid access token for the given connected account, refreshing
// it first if it is within 5 minutes of expiry. Throws a "reconnect" error
// when there is no token or it cannot be refreshed.
export async function getValidLinkedInAccessToken(
  // deno-lint-ignore no-explicit-any
  adminClient: any,
  accountId: string
): Promise<string> {
  const { data: tokenRow, error } = await adminClient
    .from('connected_account_tokens')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle()

  if (error || !tokenRow) {
    throw new Error('LinkedIn is not connected for this account — connect it in Settings → Integrations')
  }

  const expiresInMs = new Date(tokenRow.token_expires_at).getTime() - Date.now()
  if (expiresInMs > 5 * 60 * 1000) {
    return tokenRow.access_token
  }

  if (!tokenRow.refresh_token) {
    throw new Error('The LinkedIn connection has expired — reconnect LinkedIn in Settings → Integrations')
  }

  const refreshed = await refreshAccessToken({
    refreshToken: tokenRow.refresh_token,
    clientId: Deno.env.get('LINKEDIN_CLIENT_ID')!,
    clientSecret: Deno.env.get('LINKEDIN_CLIENT_SECRET')!,
  }).catch((err) => {
    throw new Error(`The LinkedIn connection could not be renewed (${err.message}) — reconnect LinkedIn in Settings → Integrations`)
  })

  await adminClient
    .from('connected_account_tokens')
    .update(tokenColumns(refreshed))
    .eq('account_id', accountId)

  return refreshed.access_token
}

export function postUrlFor(postUrn: string) {
  return `https://www.linkedin.com/feed/update/${postUrn}/`
}
