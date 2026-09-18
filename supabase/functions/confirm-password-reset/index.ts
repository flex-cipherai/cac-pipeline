// Supabase Edge Function: confirm-password-reset
// Verifies a self-service reset token (from request-password-reset or
// manage-users' reset_password action) and sets the new password.
//
// Deploy: supabase functions deploy confirm-password-reset

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { consumePasswordReset } from '../_shared/passwordReset.ts'

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
    const { token, password } = await req.json()
    if (!token || !password) {
      return jsonResponse({ success: false, error: 'Missing token or password' }, 400)
    }
    if (password.length < 8) {
      return jsonResponse({ success: false, error: 'Password must be at least 8 characters' }, 400)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    await consumePasswordReset(adminClient, { token, password })

    return jsonResponse({ success: true })
  } catch (error) {
    return jsonResponse({ success: false, error: error.message }, 400)
  }
})
