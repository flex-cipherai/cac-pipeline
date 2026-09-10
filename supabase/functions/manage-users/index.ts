import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

    // Verify the caller is authenticated and is an admin
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

    // Check caller is admin
    const { data: callerProfile } = await anonClient
      .from('profiles')
      .select('role')
      .eq('id', caller.id)
      .single()

    if (callerProfile?.role !== 'admin') {
      return jsonResponse({ success: false, error: 'Admin access required' })
    }

    // Service role client bypasses RLS
    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    const body = await req.json()
    const { action } = body

    // ── Create User ──
    if (action === 'create_user') {
      const { email, name, role } = body
      if (!email || !name || !role) {
        return jsonResponse({ success: false, error: 'Name, email, and role are required' })
      }

      const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { name, role },
      })

      if (createError) {
        return jsonResponse({ success: false, error: createError.message })
      }

      // The handle_new_user trigger will create the profile, but update to be safe
      await adminClient
        .from('profiles')
        .update({ name, role, email })
        .eq('id', newUser.user.id)

      // Generate password reset link
      await adminClient.auth.resetPasswordForEmail(email)

      return jsonResponse({ success: true, user_id: newUser.user.id })
    }

    // ── Update Role ──
    if (action === 'update_role') {
      const { user_id, role } = body
      if (!user_id || !role) {
        return jsonResponse({ success: false, error: 'User ID and role are required' })
      }

      const { error } = await adminClient
        .from('profiles')
        .update({ role })
        .eq('id', user_id)

      if (error) {
        return jsonResponse({ success: false, error: error.message })
      }

      return jsonResponse({ success: true })
    }

    // ── Toggle Active ──
    if (action === 'toggle_active') {
      const { user_id, is_active } = body
      if (!user_id || is_active === undefined) {
        return jsonResponse({ success: false, error: 'User ID and status are required' })
      }

      const { error } = await adminClient
        .from('profiles')
        .update({ is_active })
        .eq('id', user_id)

      if (error) {
        return jsonResponse({ success: false, error: error.message })
      }

      return jsonResponse({ success: true })
    }

    // ── Resend Password Reset ──
    if (action === 'reset_password') {
      const { email, redirect_to } = body
      if (!email) {
        return jsonResponse({ success: false, error: 'Email is required' })
      }

      const { error } = await adminClient.auth.resetPasswordForEmail(email, {
        redirectTo: redirect_to || undefined,
      })

      if (error) {
        return jsonResponse({ success: false, error: error.message })
      }

      return jsonResponse({ success: true })
    }

    return jsonResponse({ success: false, error: `Unknown action: ${action}` })

  } catch (err) {
    return jsonResponse({ success: false, error: err.message || 'Internal server error' })
  }
})
