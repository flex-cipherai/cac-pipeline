// Shared helpers for the Google Search Console API, used by sm-gsc-sync.
//
// Auth is a Google *service account* rather than a user OAuth flow: this is
// server-to-server access to one site we own, so there is no consent screen
// to maintain, no refresh token to expire (OAuth apps left in "Testing"
// lose theirs after 7 days), and nothing for a user to click through. The
// service account's email is simply added as a user on the Search Console
// property.
//
// This file deliberately avoids Deno-only APIs so it can be unit-tested in
// Node (WebCrypto and fetch are standard in both).

export const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const API_BASE = 'https://www.googleapis.com/webmasters/v3'

// Search Console returns at most 25,000 rows per request.
const PAGE_SIZE = 25000

export interface ServiceAccount {
  client_email: string
  private_key: string
}

export interface GscRow {
  keys: string[]
  clicks: number
  impressions: number
  ctr: number
  position: number
}

type FetchFn = typeof fetch

// Accepts the key file's JSON as-is, or base64 of it. Base64 exists because
// pasting multi-line JSON into a shell (especially PowerShell) mangles the
// private key's newlines when setting a secret.
export function parseServiceAccount(raw: string | undefined | null): ServiceAccount {
  if (!raw || !raw.trim()) {
    throw new Error('GSC_SERVICE_ACCOUNT_JSON is not set')
  }
  const text = raw.trim()
  let json: string
  try {
    json = text.startsWith('{') ? text : atob(text)
  } catch {
    throw new Error('GSC_SERVICE_ACCOUNT_JSON is neither JSON nor valid base64')
  }
  let parsed: Partial<ServiceAccount>
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('GSC_SERVICE_ACCOUNT_JSON is not valid JSON')
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('GSC_SERVICE_ACCOUNT_JSON is missing client_email or private_key')
  }
  return { client_email: parsed.client_email, private_key: parsed.private_key }
}

function base64Url(input: string | ArrayBuffer): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function pemToDer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [A-Z ]+-----/, '')
    .replace(/-----END [A-Z ]+-----/, '')
    .replace(/\\n/g, '')
    .replace(/\s+/g, '')
  const bin = atob(body)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

// Builds and signs the RS256 JWT Google exchanges for an access token.
export async function signServiceAccountJwt(sa: ServiceAccount, nowSeconds = Math.floor(Date.now() / 1000)): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT' }
  const claims = {
    iss: sa.client_email,
    scope: GSC_SCOPE,
    aud: TOKEN_URL,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  }
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned))
  return `${unsigned}.${base64Url(signature)}`
}

export async function getAccessToken(sa: ServiceAccount, fetchFn: FetchFn = fetch): Promise<string> {
  const assertion = await signServiceAccountJwt(sa)
  const res = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `Google token request failed (${res.status})`)
  }
  return data.access_token
}

async function gscRequest(token: string, path: string, init: RequestInit, fetchFn: FetchFn) {
  const res = await fetchFn(`${API_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = data?.error?.message || `Search Console API error (${res.status})`
    // 403 almost always means the service account was never added to the property.
    if (res.status === 403) {
      throw new Error(`${msg} — add the service account's email as a user on this property in Search Console`)
    }
    throw new Error(msg)
  }
  return data
}

export async function listSites(token: string, fetchFn: FetchFn = fetch): Promise<{ siteUrl: string; permissionLevel: string }[]> {
  const data = await gscRequest(token, '/sites', { method: 'GET' }, fetchFn)
  return data.siteEntry || []
}

// Pulls every row for the dimensions, paging through Google's 25k limit.
export async function queryAnalytics(
  token: string,
  siteUrl: string,
  opts: { startDate: string; endDate: string; dimensions: string[]; maxRows?: number },
  fetchFn: FetchFn = fetch
): Promise<GscRow[]> {
  const maxRows = opts.maxRows ?? 200000
  const rows: GscRow[] = []
  let startRow = 0
  while (rows.length < maxRows) {
    const data = await gscRequest(
      token,
      `/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      {
        method: 'POST',
        body: JSON.stringify({
          startDate: opts.startDate,
          endDate: opts.endDate,
          dimensions: opts.dimensions,
          rowLimit: PAGE_SIZE,
          startRow,
        }),
      },
      fetchFn
    )
    const page: GscRow[] = data.rows || []
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
    startRow += PAGE_SIZE
  }
  return rows.slice(0, maxRows)
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// Search Console data lags by ~2 days, so the newest day worth asking for is
// "today minus 2". Range is inclusive of both ends.
export function syncRange(days: number, today = new Date()): { startDate: string; endDate: string } {
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 2))
  const start = new Date(end.getTime() - (Math.max(1, days) - 1) * 86400000)
  return { startDate: isoDate(start), endDate: isoDate(end) }
}
