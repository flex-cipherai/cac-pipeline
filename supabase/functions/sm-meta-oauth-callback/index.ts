// Supabase Edge Function: sm-meta-oauth-callback
// Facebook Login redirects the admin's browser here after they approve (or
// cancel). Public GET endpoint — deploy with --no-verify-jwt; security comes
// from the one-time `state` row created by sm-meta-oauth-start.
//
// Saves every Facebook Page the person manages and each Page's linked
// Instagram professional account (_shared/meta.ts → syncMetaAccounts), with
// the Page tokens (service-role-only table), then redirects to
// /settings?meta=<status>. The admin chooses which accounts the BMS manages.
//
// The Meta app's "Valid OAuth Redirect URIs" must include
// https://<project-ref>.supabase.co/functions/v1/sm-meta-oauth-callback
//
// Deploy: supabase functions deploy sm-meta-oauth-callback --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { exchangeMetaCode, friendlyMetaError, graph, syncMetaAccounts } from '../_shared/meta.ts'

// What the BMS needs to publish, read insights and reply on Pages and Instagram.
const REQUIRED_SCOPES = [
  'pages_show_list', 'pages_manage_posts', 'pages_read_engagement', 'pages_read_user_content', 'pages_manage_engagement',
  'read_insights', 'instagram_basic', 'instagram_content_publish', 'instagram_manage_comments', 'instagram_manage_insights',
]

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const metaError = url.searchParams.get('error_description') || url.searchParams.get('error_message') || url.searchParams.get('error')

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const db = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  let redirectOrigin = ''
  let valid = false
  if (state) {
    const { data } = await db.from('oauth_states').select('redirect_origin, created_at').eq('state', state).eq('provider', 'meta').maybeSingle()
    if (data) {
      redirectOrigin = data.redirect_origin
      await db.from('oauth_states').delete().eq('state', state)
      valid = Date.now() - new Date(data.created_at).getTime() < 60 * 60 * 1000
    }
  }

  function back(status: string, detail?: string) {
    if (!redirectOrigin) return new Response(`Meta connection ${status}${detail ? `: ${detail}` : ''}`, { status: 200 })
    const params = new URLSearchParams({ meta: status, ...(detail ? { detail } : {}) })
    return new Response(null, { status: 302, headers: { Location: `${redirectOrigin.replace(/\/$/, '')}/settings?${params.toString()}` } })
  }

  if (metaError) return back('error', metaError)
  if (!code || !valid) return back('error', 'Invalid or expired connection request — please try again')

  try {
    const userToken = await exchangeMetaCode(code, `${supabaseUrl}/functions/v1/sm-meta-oauth-callback`)

    // Which permissions were actually granted (the Login for Business
    // configuration decides what Meta asks for).
    const perms = await graph('me/permissions', userToken).catch(() => ({ data: [] }))
    const granted = new Set((perms.data || []).filter((p: any) => p.status === 'granted').map((p: any) => p.permission))
    const missing = REQUIRED_SCOPES.filter((s) => !granted.has(s))

    const accounts = await syncMetaAccounts(db, userToken)
    if (!accounts.length) return back('error', 'No Facebook Pages were shared — reconnect and select your Page (and its Instagram account)')
    const fb = accounts.filter(a => a.platform === 'facebook').length
    const ig = accounts.filter(a => a.platform === 'instagram').length
    if (missing.length) {
      return back('missing_permissions', `Connected ${fb} Page${fb === 1 ? '' : 's'}, but Meta did not grant: ${missing.join(', ')}. Add them to the Facebook Login for Business configuration in the Meta app, then press Reconnect Meta.`)
    }
    if (!ig) {
      return back('connected_no_instagram', `${fb} Facebook Page${fb === 1 ? '' : 's'} connected, but no Instagram account is linked to ${fb === 1 ? 'it' : 'them'}. Link the Instagram professional account to the Page (Page settings → Linked accounts), then press Reconnect Meta.`)
    }
    return back('connected', `${fb} Facebook Page${fb === 1 ? '' : 's'} and ${ig} Instagram account${ig === 1 ? '' : 's'}`)
  } catch (err) {
    console.error('[sm-meta-oauth-callback]', (err as Error).message)
    return back('error', friendlyMetaError(err))
  }
})
