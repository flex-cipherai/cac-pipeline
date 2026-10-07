// Supabase Edge Function: sm-linkedin-oauth-callback
// LinkedIn redirects the admin's browser here directly after they approve
// (or deny) access — this is a public GET endpoint, not an authenticated
// app call, so it must be deployed with --no-verify-jwt. Security comes
// from the one-time `state` row created by sm-linkedin-oauth-start, not
// from a Supabase session.
//
// Exchanges the code for tokens, stores them (service-role only table —
// never exposed to the frontend), tries to resolve which LinkedIn
// Organization the member administers, and 302-redirects back to the app's
// Settings page with a status query param.
//
// Deploy: supabase functions deploy sm-linkedin-oauth-callback --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { exchangeCodeForToken, decodeMemberUrnFromIdToken, fetchAdministeredOrganizations } from '../_shared/linkedin.ts'

function redirectTo(url: string) {
  return new Response(null, { status: 302, headers: { Location: url } })
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const linkedinError = url.searchParams.get('error')
  const linkedinErrorDescription = url.searchParams.get('error_description')

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const adminClient = createClient(supabaseUrl, serviceRoleKey)

  // We need the state row to know where to send the browser back to, even
  // on failure — fall back to no redirect (plain error text) only if the
  // state itself can't be resolved at all.
  let redirectOrigin = ''
  let stateRow: { user_id: string; redirect_origin: string } | null = null

  if (state) {
    const { data } = await adminClient
      .from('oauth_states')
      .select('user_id, redirect_origin')
      .eq('state', state)
      .eq('provider', 'linkedin')
      .maybeSingle()
    if (data) {
      stateRow = data
      redirectOrigin = data.redirect_origin
      // Single-use: remove immediately so it can't be replayed.
      await adminClient.from('oauth_states').delete().eq('state', state)
    }
  }

  function toSettings(status: string, detail?: string) {
    if (!redirectOrigin) {
      return new Response(`LinkedIn connection ${status}${detail ? `: ${detail}` : ''} (could not resolve app origin to redirect to)`, { status: 200 })
    }
    const params = new URLSearchParams({ linkedin: status, ...(detail ? { detail } : {}) })
    return redirectTo(`${redirectOrigin.replace(/\/$/, '')}/settings?${params.toString()}`)
  }

  if (linkedinError) {
    return toSettings('error', linkedinErrorDescription || linkedinError)
  }
  if (!code || !state || !stateRow) {
    return toSettings('error', 'Invalid or expired connection request — please try again')
  }

  try {
    const clientId = Deno.env.get('LINKEDIN_CLIENT_ID')!
    const clientSecret = Deno.env.get('LINKEDIN_CLIENT_SECRET')!
    const redirectUri = `${supabaseUrl}/functions/v1/sm-linkedin-oauth-callback`

    const token = await exchangeCodeForToken({ code, redirectUri, clientId, clientSecret })
    const memberUrn = decodeMemberUrnFromIdToken(token.id_token)

    const { data: account, error: accountError } = await adminClient
      .from('connected_accounts')
      .select('id')
      .eq('platform', 'linkedin')
      .maybeSingle()

    if (accountError || !account) {
      return toSettings('error', 'No LinkedIn connected_accounts row found — run the Phase 1 social media migration first')
    }

    const now = Date.now()
    await adminClient.from('connected_account_tokens').upsert({
      account_id: account.id,
      access_token: token.access_token,
      refresh_token: token.refresh_token || null,
      token_expires_at: new Date(now + token.expires_in * 1000).toISOString(),
      refresh_token_expires_at: token.refresh_token_expires_in
        ? new Date(now + token.refresh_token_expires_in * 1000).toISOString()
        : null,
      scope: token.scope || null,
      linkedin_member_urn: memberUrn,
    }, { onConflict: 'account_id' })

    await adminClient.from('connected_accounts').update({ oauth_connected: true }).eq('id', account.id)

    // Requires rw_organization_admin, which only becomes grantable once
    // LinkedIn approves the Community Management API product — until then
    // this will 403 and we leave the account in "connected, not yet linked
    // to an Organization" state rather than failing the whole flow.
    let orgUrn: string | null = null
    try {
      const orgs = await fetchAdministeredOrganizations(token.access_token)
      orgUrn = orgs[0] || null
    } catch (err) {
      console.warn('[sm-linkedin-oauth-callback] organizationAcls not available yet:', err.message)
    }

    if (orgUrn) {
      await adminClient
        .from('connected_accounts')
        .update({ external_page_id: orgUrn, mode: 'automated' })
        .eq('id', account.id)
      return toSettings('connected')
    }

    // Tokens are stored either way — publish/analytics will start working
    // automatically once the Community Management API product is approved
    // and a re-connect (or the next scheduled refresh) resolves the org.
    return toSettings('connected_pending_api_approval')
  } catch (err) {
    console.error('[sm-linkedin-oauth-callback] failed:', err.message)
    return toSettings('error', err.message)
  }
})
