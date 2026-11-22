// Supabase Edge Function: sm-instagram-oauth-start
// Called by an authenticated admin from Settings → Integrations
// ("Connect Instagram"). Verifies the caller, stores a short-lived CSRF
// state row, and returns the Instagram Login authorization URL for the browser to
// navigate to. The redirect_uri here MUST exactly match one of the
// "Authorized redirect URLs" configured on the Meta app's Instagram use case (API setup with Instagram login → Business login settings → OAuth redirect URIs) —
// it points at sm-instagram-oauth-callback, not the frontend, since only an
// Edge Function can safely hold the Client Secret for the token exchange.
//
// Deploy: supabase functions deploy sm-instagram-oauth-start

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildInstagramAuthUrl } from '../_shared/meta.ts'

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
    if (!Deno.env.get('INSTAGRAM_APP_ID')) return jsonResponse({ success: false, error: 'INSTAGRAM_APP_ID is not set yet — add the Instagram app ID and secret to Supabase secrets' })
    // An app ID is digits only; a long value starting with letters is usually an access token pasted by mistake.
    if (!/^d{6,20}$/.test((Deno.env.get('INSTAGRAM_APP_ID') || '').trim())) {
      return jsonResponse({ success: false, error: 'The INSTAGRAM_APP_ID secret is not an app ID (it should be digits only). Copy the Instagram app ID from the Meta app → Instagram use case → API setup with Instagram login, and update the secret in Supabase.' })
    }

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
      .eq('provider', 'instagram')
      .lt('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())

    const state = crypto.randomUUID()
    const { error: insertError } = await adminClient.from('oauth_states').insert({
      state,
      provider: 'instagram',
      user_id: caller.id,
      redirect_origin: redirectOrigin,
    })
    if (insertError) {
      return jsonResponse({ success: false, error: insertError.message })
    }

    const redirectUri = `${supabaseUrl}/functions/v1/sm-instagram-oauth-callback`
    const url = buildInstagramAuthUrl({ redirectUri, state })

    return jsonResponse({ success: true, url })
  } catch (err) {
    return jsonResponse({ success: false, error: err.message || 'Internal server error' })
  }
})
