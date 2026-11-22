// Supabase Edge Function: bms-mcp — the Claude connector for the BMS.
//
// Reached through the BMS domain (netlify.toml proxies these paths here), so
// Claude sees one origin, https://spm.sdfmgroup.com:
//   POST /mcp                                     MCP (Streamable HTTP, JSON responses)
//   GET  /.well-known/oauth-protected-resource    where to sign in
//   GET  /.well-known/oauth-authorization-server  OAuth server metadata
//   POST /oauth/register                          dynamic client registration
//   POST /oauth/token                             code → tokens, refresh
//   POST /oauth/revoke                            revoke a token
//   GET  /oauth/client?client_id=                 consent page: who is asking
//   POST /oauth/approve                           consent page (BMS session): issue a code
// /oauth/authorize itself is a page of the BMS app (src/pages/OAuthAuthorize.jsx).
//
// Tools: _shared/bmsTools.ts. OAuth: _shared/mcpOAuth.ts.
// Deploy: supabase functions deploy bms-mcp --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  OAuthError, approve, authServerMetadata, getClient, protectedResourceMetadata, publicBase,
  registerClient, revoke, token, userFromAccessToken,
} from '../_shared/mcpOAuth.ts'
import { TOOLS, ToolError } from '../_shared/bmsTools.ts'

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id',
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } })
}

async function readParams(req: Request): Promise<Record<string, string>> {
  const type = req.headers.get('content-type') || ''
  if (type.includes('application/json')) return await req.json().catch(() => ({}))
  const text = await req.text()
  return Object.fromEntries(new URLSearchParams(text))
}

const INSTRUCTIONS = `This is SDFM Group's Business Management Solution (BMS). You act as the signed-in BMS user, with their permissions.
- Social media: social_list_accounts first to get account ids. Before publishing, replying publicly or deleting, show the user exactly what will happen and get a clear yes.
- Times: the team works in Africa/Nairobi (UTC+3); pass ISO date-times with an offset.
- Sales: leads move through Scheduled → Call Done → Questions Prep → Questions Sent → Responses In → Report Prep → Presented → Contract Out → Converted.
- Media must already be in the BMS Content Library (social_list_media).`

async function handleRpc(db: any, user: any, msg: any) {
  const { id, method, params } = msg || {}
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id, result })
  const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } })
  if (typeof method !== 'string') return fail(-32600, 'Invalid request')
  if (method.startsWith('notifications/')) return null

  switch (method) {
    case 'initialize': {
      const asked = params?.protocolVersion
      return reply({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'sdfm-bms', title: 'SDFM BMS', version: '1.0.0' },
        instructions: INSTRUCTIONS,
      })
    }
    case 'ping':
      return reply({})
    case 'tools/list':
      return reply({ tools: TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations })) })
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params?.name)
      if (!tool) return fail(-32602, `Unknown tool: ${params?.name}`)
      try {
        const result = await tool.run({ db, user }, params?.arguments || {})
        return reply({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] })
      } catch (err) {
        const message = err instanceof ToolError ? err.message : `Something went wrong: ${(err as Error).message}`
        if (!(err instanceof ToolError)) console.error('[bms-mcp]', tool.name, (err as Error).message)
        return reply({ content: [{ type: 'text', text: message }], isError: true })
      }
    }
    case 'resources/list': return reply({ resources: [] })
    case 'prompts/list': return reply({ prompts: [] })
    default:
      return fail(-32601, `Method not found: ${method}`)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const url = new URL(req.url)
  const path = url.pathname.replace(/^.*\/bms-mcp/, '') || '/'
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  try {
    // ── Discovery ──
    if (path.startsWith('/.well-known/oauth-protected-resource')) return json(protectedResourceMetadata())
    if (path.startsWith('/.well-known/oauth-authorization-server') || path.startsWith('/.well-known/openid-configuration')) return json(authServerMetadata())

    // ── OAuth ──
    if (path === '/oauth/register' && req.method === 'POST') return json(await registerClient(db, await req.json().catch(() => ({}))), 201)
    if (path === '/oauth/token' && req.method === 'POST') return json(await token(db, await readParams(req)))
    if (path === '/oauth/revoke' && req.method === 'POST') { await revoke(db, (await readParams(req)).token || ''); return json({}) }
    if (path === '/oauth/client' && req.method === 'GET') {
      const c = await getClient(db, url.searchParams.get('client_id') || '')
      const redirect = url.searchParams.get('redirect_uri') || ''
      if (!c) return json({ error: 'invalid_client', error_description: 'Unknown client' }, 404)
      return json({ client_name: c.client_name, redirect_ok: c.redirect_uris.includes(redirect) })
    }
    if (path === '/oauth/approve' && req.method === 'POST') {
      const auth = req.headers.get('Authorization') || ''
      const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
      const { data: { user } } = await anon.auth.getUser()
      if (!user) return json({ error: 'login_required', error_description: 'Sign in to the BMS first' }, 401)
      const { data: profile } = await db.from('profiles').select('is_active').eq('id', user.id).maybeSingle()
      if (!profile || profile.is_active === false) return json({ error: 'access_denied', error_description: 'Your BMS account is not active' }, 403)
      const p = await req.json().catch(() => ({}))
      if (p.decision === 'deny') {
        const c = await getClient(db, p.client_id)
        if (!c || !c.redirect_uris.includes(p.redirect_uri)) throw new OAuthError('invalid_request', 'Unknown client or redirect')
        const back = new URL(p.redirect_uri)
        back.searchParams.set('error', 'access_denied')
        if (p.state) back.searchParams.set('state', p.state)
        return json({ redirect: back.toString() })
      }
      return json({ redirect: await approve(db, user.id, p) })
    }

    // ── MCP ──
    if (path === '/mcp' || path === '/') {
      if (req.method !== 'POST') return json({ error: 'Use POST for MCP requests' }, 405, { Allow: 'POST' })
      const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '') || null
      const user = await userFromAccessToken(db, bearer)
      if (!user) {
        return json({ error: 'unauthorized', error_description: 'Sign in to the BMS to use this connector' }, 401, {
          'WWW-Authenticate': `Bearer resource_metadata="${publicBase()}/.well-known/oauth-protected-resource"`,
        })
      }
      const body = await req.json().catch(() => null)
      if (!body) return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400)
      if (Array.isArray(body)) {
        const out = (await Promise.all(body.map((m) => handleRpc(db, user, m)))).filter(Boolean)
        return out.length ? json(out) : new Response(null, { status: 202, headers: cors })
      }
      const out = await handleRpc(db, user, body)
      return out ? json(out) : new Response(null, { status: 202, headers: cors })
    }

    return json({ error: 'not_found' }, 404)
  } catch (err) {
    if (err instanceof OAuthError) return json({ error: err.code, error_description: err.message }, err.status)
    console.error('[bms-mcp]', (err as Error).message)
    return json({ error: 'server_error', error_description: (err as Error).message }, 500)
  }
})
