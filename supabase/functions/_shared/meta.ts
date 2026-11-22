// Meta (Facebook Pages + Instagram professional accounts) — Graph API client,
// login and account discovery. Connectors: _shared/platforms/facebook.ts and
// instagram.ts. Secrets: META_APP_ID, META_APP_SECRET and, for Facebook
// Login for Business, META_LOGIN_CONFIG_ID (the configuration holds the
// permissions; without it the scopes below are requested directly).

// Graph API version. Each version is supported for about two years — bump it
// before it is retired (developers.facebook.com/docs/graph-api/changelog).
export const META_GRAPH_VERSION = 'v24.0'
export const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`

export const META_SCOPES = [
  'pages_show_list', 'pages_manage_posts', 'pages_read_engagement', 'pages_read_user_content',
  'pages_manage_engagement', 'read_insights', 'business_management',
  'instagram_basic', 'instagram_content_publish', 'instagram_manage_comments', 'instagram_manage_insights',
]

export class GraphError extends Error {
  code: number
  constructor(message: string, code = 0) { super(message); this.code = code }
}

// GET (params in the query) or POST (params as a form body) to the Graph API.
export async function graph(path: string, token: string, params: Record<string, string | number | boolean | undefined> = {}, method: 'GET' | 'POST' | 'DELETE' = 'GET') {
  const url = new URL(path.startsWith('http') ? path : `${GRAPH}/${path.replace(/^\//, '')}`)
  const body = new URLSearchParams()
  const target = method === 'GET' ? url.searchParams : body
  for (const [k, v] of Object.entries(params)) if (v !== undefined) target.set(k, String(v))
  if (token && !url.searchParams.has('access_token')) {
    if (method === 'GET') url.searchParams.set('access_token', token)
    else body.set('access_token', token)
  }
  const res = await fetch(url, method === 'GET' ? {} : { method, body })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data?.error) {
    const e = data?.error || {}
    throw new GraphError(`Meta ${res.status}: ${e.error_user_msg || e.message || res.statusText}`.slice(0, 300), e.code || res.status)
  }
  return data
}

// Follows paging.next until done (or `max` items).
export async function graphAll(path: string, token: string, params: Record<string, string | number | undefined> = {}, max = 1000) {
  const out: any[] = []
  let page = await graph(path, token, params)
  while (true) {
    out.push(...(page.data || []))
    if (out.length >= max || !page.paging?.next) break
    page = await graph(page.paging.next, token)
  }
  return out
}

export function buildMetaAuthUrl({ redirectUri, state }: { redirectUri: string; state: string }) {
  const params = new URLSearchParams({
    client_id: Deno.env.get('META_APP_ID')!,
    redirect_uri: redirectUri,
    state,
    response_type: 'code',
  })
  const configId = Deno.env.get('META_LOGIN_CONFIG_ID')
  if (configId) {
    params.set('config_id', configId)
    params.set('override_default_response_type', 'true')
  } else {
    params.set('scope', META_SCOPES.join(','))
  }
  return `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth?${params.toString()}`
}

// Code → long-lived user token (about 60 days). Page tokens obtained with a
// long-lived user token do not expire (until the user's access is removed).
export async function exchangeMetaCode(code: string, redirectUri: string) {
  const id = Deno.env.get('META_APP_ID')!
  const secret = Deno.env.get('META_APP_SECRET')!
  const short = await graph('oauth/access_token', '', { client_id: id, client_secret: secret, redirect_uri: redirectUri, code })
  const long = await graph('oauth/access_token', '', { grant_type: 'fb_exchange_token', client_id: id, client_secret: secret, fb_exchange_token: short.access_token })
  return long.access_token as string
}

const NEVER = '2099-12-31T00:00:00Z'

// deno-lint-ignore no-explicit-any
type Db = any

// Saves every Facebook Page the person manages, and the Instagram
// professional account linked to each, as connected_accounts rows (one per
// account, keyed by platform + external id). New accounts start unmanaged
// unless none of that platform is managed yet — the admin picks in
// Settings → Integrations, like LinkedIn pages.
export async function syncMetaAccounts(db: Db, userToken: string) {
  const pages = await graphAll('me/accounts', userToken, {
    fields: 'id,name,access_token,picture{url},instagram_business_account{id,username,name,profile_picture_url}',
    limit: 100,
  })

  const { data: existing } = await db.from('connected_accounts').select('id, platform, external_page_id, status')
    .in('platform', ['facebook', 'instagram'])
  const rows = existing || []
  const managed = { facebook: rows.some((r: any) => r.platform === 'facebook' && r.status === 'active'), instagram: rows.some((r: any) => r.platform === 'instagram' && r.status === 'active') }
  const result: { platform: string; name: string; is_new: boolean }[] = []

  async function upsert(platform: 'facebook' | 'instagram', externalId: string, fields: Record<string, unknown>, token: string) {
    const found = rows.find((r: any) => r.platform === platform && r.external_page_id === externalId)
    let id = found?.id
    if (found) {
      await db.from('connected_accounts').update({ ...fields, mode: 'automated', oauth_connected: true, last_sync_error: null }).eq('id', id)
    } else {
      const status = managed[platform] ? 'disconnected' : 'active'
      managed[platform] = true
      const { data, error } = await db.from('connected_accounts').insert({
        platform, external_page_id: externalId, ...fields, mode: 'automated', oauth_connected: true, status,
      }).select('id').single()
      if (error) throw new Error(`Could not save ${fields.account_name}: ${error.message}`)
      id = data.id
    }
    await db.from('connected_account_tokens').upsert({ account_id: id, access_token: token, token_expires_at: NEVER, scope: 'meta-page' }, { onConflict: 'account_id' })
    result.push({ platform, name: String(fields.account_name), is_new: !found })
  }

  for (const p of pages) {
    if (!p.access_token) continue
    await upsert('facebook', p.id, { account_name: p.name, account_type: 'page', avatar_url: p.picture?.data?.url || null }, p.access_token)
    const ig = p.instagram_business_account
    if (ig?.id) {
      // Instagram calls use the linked Page's token.
      await upsert('instagram', ig.id, { account_name: ig.username || ig.name || 'Instagram', account_type: 'business', avatar_url: ig.profile_picture_url || null }, p.access_token)
    }
  }
  return result
}

export async function getStoredMetaToken(db: Db, accountId: string) {
  const { data } = await db.from('connected_account_tokens').select('access_token').eq('account_id', accountId).maybeSingle()
  if (!data?.access_token) throw new Error('This account is not connected — connect Meta in Settings → Integrations')
  return data.access_token as string
}

// Turns a Meta permission/token error into the action the user should take.
export function friendlyMetaError(err: unknown) {
  const e = err as GraphError
  if (e?.code === 190 || /access token|session has been invalidated/i.test(e?.message || '')) {
    return 'The Meta connection has expired — reconnect Meta in Settings → Integrations'
  }
  if (e?.code === 10 || e?.code === 200 || /permission/i.test(e?.message || '')) {
    return `Meta refused: ${e.message}. Reconnect Meta and make sure every permission is granted.`
  }
  return e?.message || 'Meta request failed'
}

// "YYYY-MM-DD" (UTC) for an insight value's end_time (the day it covers ends at end_time).
export function insightDay(endTime: string) {
  return new Date(new Date(endTime).getTime() - 1000).toISOString().slice(0, 10)
}
