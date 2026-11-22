// Supabase Edge Function: sm-meta-oauth-start
// Called by an authenticated admin from Settings → Integrations
// ("Connect Meta"). Verifies the caller, stores a short-lived CSRF
// state row, and returns the Meta (Facebook Login) authorization URL for the browser to
// navigate to. The redirect_uri here MUST exactly match one of the
// "Authorized redirect URLs" configured on the Meta app (Facebook Login → Valid OAuth Redirect URIs) —
// it points at sm-meta-oauth-callback, not the frontend, since only an
// Edge Function can safely hold the Client Secret for the token exchange.
//
// Deploy: supabase functions deploy sm-meta-oauth-start

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildMetaAuthUrl } from '../_shared/meta.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    if (!Deno.env.get('META_APP_ID')) return jsonResponse({ success: false, error: 'META_APP_ID is not set in Supabase secrets' })

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return jsonResponse({ success: false, error: 'Missing authorization' })
    }

    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user: caller }, error: authError } = await anonClient.auth.getUser()
    if (authError || !caller) {
      return jsonResponse({ success: false, error: 'Unauthorized — please sign in again' })
    }

    const { data: callerProfile } = await anonClient
      .from('profiles')
      .select('role')
      .eq('id', caller.id)
      .single()

    if (callerProfile?.role !== 'admin') {
      return jsonResponse({ success: false, error: 'Admin access required' })
    }

    const body = await req.json().catch(() => ({}))
    const redirectOrigin = body.redirect_origin
    if (!redirectOrigin) {
      return jsonResponse({ success: false, error: 'redirect_origin is required' })
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    // Best-effort cleanup of abandoned states from earlier attempts.
    await adminClient
      .from('oauth_states')
      .delete()
      .eq('provider', 'meta')
      .lt('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())

    const state = crypto.randomUUID()
    const { error: insertError } = await adminClient.from('oauth_states').insert({
      state,
      provider: 'meta',
      user_id: caller.id,
      redirect_origin: redirectOrigin,
    })
    if (insertError) {
      return jsonResponse({ success: false, error: insertError.message })
    }

    const redirectUri = `${supabaseUrl}/functions/v1/sm-meta-oauth-callback`
    const url = buildMetaAuthUrl({ redirectUri, state })

    return jsonResponse({ success: true, url })
  } catch (err) {
    return jsonResponse({ success: false, error: err.message || 'Internal server error' })
  }
})
