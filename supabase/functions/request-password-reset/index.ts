// Supabase Edge Function: request-password-reset
// Self-service password reset (public, unauthenticated). Always returns a
// generic success response regardless of whether the email exists, to avoid
// leaking which addresses are registered.
//
// Deploy: supabase functions deploy request-password-reset
// Requires: RESEND_API_KEY, SENDER_EMAIL (same as send-email)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { issuePasswordReset } from '../_shared/passwordReset.ts'

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

const GENERIC_RESPONSE = { success: true, message: 'If an account exists for that email, a reset link has been sent.' }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { email, redirect_origin } = await req.json()
    if (!email || !redirect_origin) {
      return jsonResponse({ success: false, error: 'Missing email or redirect_origin' }, 400)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    const { data: profile } = await adminClient
      .from('profiles')
      .select('id, email, name')
      .ilike('email', email)
      .maybeSingle()

    if (!profile) {
      return jsonResponse(GENERIC_RESPONSE)
    }

    try {
      const result = await issuePasswordReset(adminClient, {
        userId: profile.id,
        email: profile.email,
        fullName: profile.name,
        redirectOrigin: redirect_origin,
      })
      if (!result.sent) console.error('[request-password-reset]', result.reason)
    } catch (err) {
      console.error('[request-password-reset] issue failed:', err.message)
    }

    return jsonResponse(GENERIC_RESPONSE)
  } catch (error) {
    return jsonResponse({ success: false, error: error.message }, 500)
  }
})
