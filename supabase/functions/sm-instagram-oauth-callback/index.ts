// Supabase Edge Function: sm-instagram-oauth-callback
// Instagram Login ("Business Login for Instagram") redirects here after the
// admin approves. Public GET endpoint — deploy with --no-verify-jwt; security
// comes from the one-time `state` row created by sm-instagram-oauth-start.
//
// Exchanges the code for a 60-day token (refreshed automatically by
// getInstagramToken), saves the Instagram professional account as a
// connected_accounts row (platform 'instagram') and redirects to
// /settings?instagram=<status>.
//
// The Meta app's Instagram use case must list this as an OAuth redirect URI:
// https://<project-ref>.supabase.co/functions/v1/sm-instagram-oauth-callback
//
// Deploy: supabase functions deploy sm-instagram-oauth-callback --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { exchangeInstagramCode, friendlyMetaError, INSTAGRAM_SCOPES, saveInstagramLoginAccount } from '../_shared/meta.ts'

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const igError = url.searchParams.get('error_description') || url.searchParams.get('error_reason') || url.searchParams.get('error')

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const db = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  let redirectOrigin = ''
  let valid = false
  if (state) {
    const { data } = await db.from('oauth_states').select('redirect_origin, created_at').eq('state', state).eq('provider', 'instagram').maybeSingle()
    if (data) {
      redirectOrigin = data.redirect_origin
      await db.from('oauth_states').delete().eq('state', state)
      valid = Date.now() - new Date(data.created_at).getTime() < 60 * 60 * 1000
    }
  }

  function back(status: string, detail?: string) {
    if (!redirectOrigin) return new Response(`Instagram connection ${status}${detail ? `: ${detail}` : ''}`, { status: 200 })
    const params = new URLSearchParams({ instagram: status, ...(detail ? { detail } : {}) })
    return new Response(null, { status: 302, headers: { Location: `${redirectOrigin.replace(/\/$/, '')}/settings?${params.toString()}` } })
  }

  if (igError) return back('error', igError)
  if (!code || !valid) return back('error', 'Invalid or expired connection request — please try again')

  try {
    const { token, expiresIn, permissions } = await exchangeInstagramCode(code, `${supabaseUrl}/functions/v1/sm-instagram-oauth-callback`)
    const saved = await saveInstagramLoginAccount(db, token, expiresIn)
    const granted = new Set(permissions.split(',').map((p) => p.trim()).filter(Boolean))
    const missing = granted.size ? INSTAGRAM_SCOPES.filter((s) => !granted.has(s)) : []
    if (missing.length) {
      return back('missing_permissions', `@${saved.username} connected, but Instagram did not grant: ${missing.join(', ')}. Press Connect Instagram again and allow everything.`)
    }
    return back('connected', `@${saved.username}`)
  } catch (err) {
    console.error('[sm-instagram-oauth-callback]', (err as Error).message)
    return back('error', friendlyMetaError(err))
  }
})
