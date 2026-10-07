// Shared helpers for LinkedIn Community Management API access (Phase 2).
// Used by sm-linkedin-oauth-start / sm-linkedin-oauth-callback now, and by
// the future sm-publish / sm-fetch-analytics / sm-fetch-activity functions
// once LinkedIn approves the Community Management API product — no other
// code changes needed at that point, per the spec's "connector swaps in
// behind the same interface" principle.

// Bump this periodically per LinkedIn's versioning docs (LinkedIn-Version
// header, format YYYYMM). Required on every REST API (not OAuth) call.
export const LINKEDIN_API_VERSION = '202405'

export const LINKEDIN_AUTH_BASE = 'https://www.linkedin.com/oauth/v2'
export const LINKEDIN_API_BASE = 'https://api.linkedin.com/rest'

// Community Management API organic-posting scopes. openid/profile are
// auto-approved and identify the connecting member; the organization scopes
// only become grantable once LinkedIn approves the Community Management API
// product for this app — until then LinkedIn will simply not include them
// in the consent screen / granted scope, which the callback handles.
export const LINKEDIN_SCOPES = [
  'openid',
  'profile',
  'r_organization_social',
  'w_organization_social',
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
  id_token?: string
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

// Decodes the unverified payload of the OIDC id_token LinkedIn returns
// alongside the access token, just to read the member's URN (`sub`) — this
// is informational only (which member connected the account), not used for
// authentication, so signature verification is unnecessary here.
export function decodeMemberUrnFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null
  try {
    const payload = idToken.split('.')[1]
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    return json.sub ? `urn:li:person:${json.sub}` : null
  } catch {
    return null
  }
}

// Fetches the LinkedIn Organizations the connected member administers.
// Requires rw_organization_admin — will fail with 403 until the Community
// Management API product is approved; callers should treat that as
// "connected, but organization not yet linked" rather than a hard failure.
export async function fetchAdministeredOrganizations(accessToken: string) {
  const res = await fetch(
    `${LINKEDIN_API_BASE}/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'LinkedIn-Version': LINKEDIN_API_VERSION,
        'X-Restli-Protocol-Version': '2.0.0',
      },
    }
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`organizationAcls request failed (${res.status}): ${body}`)
  }
  const data = await res.json()
  return (data.elements || []).map((el: { organization: string }) => el.organization)
}

// Returns a valid access token for the given connected account, refreshing
// it first if it's within 5 minutes of expiry (or already expired). Throws
// if there's no token on file or the refresh fails — callers (sm-publish,
// sm-fetch-analytics, etc.) should surface that as "reconnect LinkedIn".
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
    throw new Error('LinkedIn is not connected for this account')
  }

  const expiresInMs = new Date(tokenRow.token_expires_at).getTime() - Date.now()
  if (expiresInMs > 5 * 60 * 1000) {
    return tokenRow.access_token
  }

  if (!tokenRow.refresh_token) {
    throw new Error('LinkedIn access token expired and no refresh token is on file — reconnect LinkedIn in Settings')
  }

  const clientId = Deno.env.get('LINKEDIN_CLIENT_ID')!
  const clientSecret = Deno.env.get('LINKEDIN_CLIENT_SECRET')!
  const refreshed = await refreshAccessToken({ refreshToken: tokenRow.refresh_token, clientId, clientSecret })

  const now = Date.now()
  await adminClient
    .from('connected_account_tokens')
    .update({
      access_token: refreshed.access_token,
      token_expires_at: new Date(now + refreshed.expires_in * 1000).toISOString(),
      ...(refreshed.refresh_token ? { refresh_token: refreshed.refresh_token } : {}),
      ...(refreshed.refresh_token_expires_in
        ? { refresh_token_expires_at: new Date(now + refreshed.refresh_token_expires_in * 1000).toISOString() }
        : {}),
    })
    .eq('account_id', accountId)

  return refreshed.access_token
}
