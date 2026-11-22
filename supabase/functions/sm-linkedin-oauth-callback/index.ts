// Supabase Edge Function: sm-linkedin-oauth-callback
// LinkedIn redirects the admin's browser here after they approve (or deny)
// access. Public GET endpoint — deploy with --no-verify-jwt. Security comes
// from the one-time `state` row created by sm-linkedin-oauth-start.
//
// One connection sets up two publishing targets:
//   - the connecting person's own LinkedIn profile (a connected_accounts row
//     with account_type 'member', owned by that BMS user), and
//   - the LinkedIn Company Page they administer (the 'organization' row).
// Both switch to Automated Mode. Tokens go in connected_account_tokens
// (service-role only — never readable from the browser).
//
// Redirects back to /settings?linkedin=<status>.
//
// Deploy: supabase functions deploy sm-linkedin-oauth-callback --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  exchangeCodeForToken, fetchAdministeredOrganizations, fetchMe, fetchOrganizationName, tokenColumns,
} from '../_shared/linkedin.ts'

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

  let redirectOrigin = ''
  let stateRow: { user_id: string; redirect_origin: string } | null = null

  if (state) {
    const { data } = await adminClient
      .from('oauth_states')
      .select('user_id, redirect_origin, created_at')
      .eq('state', state)
      .eq('provider', 'linkedin')
      .maybeSingle()
    if (data) {
      redirectOrigin = data.redirect_origin
      // Single-use, and only valid for an hour.
      await adminClient.from('oauth_states').delete().eq('state', state)
      if (Date.now() - new Date(data.created_at).getTime() < 60 * 60 * 1000) stateRow = data
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
    const columns = tokenColumns(token)
    const me = await fetchMe(token.access_token)
    const memberUrn = `urn:li:person:${me.id}`

    // ── The person's own profile ──
    const { data: existingMember } = await adminClient
      .from('connected_accounts')
      .select('id')
      .eq('account_type', 'member')
      .eq('owner_profile_id', stateRow.user_id)
      .maybeSingle()

    const memberFields = {
      platform: 'linkedin',
      account_type: 'member',
      owner_profile_id: stateRow.user_id,
      account_name: `${me.name} (profile)`,
      external_page_id: memberUrn,
      mode: 'automated',
      status: 'active',
      oauth_connected: true,
      last_sync_error: null,
    }
    let memberAccountId = existingMember?.id
    if (memberAccountId) {
      await adminClient.from('connected_accounts').update(memberFields).eq('id', memberAccountId)
    } else {
      const { data: inserted, error } = await adminClient.from('connected_accounts').insert(memberFields).select('id').single()
      if (error) throw new Error(`Could not save your LinkedIn profile: ${error.message}`)
      memberAccountId = inserted.id
    }
    await adminClient.from('connected_account_tokens').upsert({
      account_id: memberAccountId,
      ...columns,
      linkedin_member_urn: memberUrn,
    }, { onConflict: 'account_id' })

    // ── The Company Page ──
    const { data: orgAccount } = await adminClient
      .from('connected_accounts')
      .select('id, account_name')
      .eq('platform', 'linkedin')
      .eq('account_type', 'organization')
      .order('created_at')
      .limit(1)
      .maybeSingle()

    let orgUrn: string | null = null
    let orgProblem = ''
    try {
      const orgs = await fetchAdministeredOrganizations(token.access_token)
      orgUrn = orgs[0] || null
      if (!orgUrn) orgProblem = 'you are not an admin of any LinkedIn Company Page'
    } catch (err) {
      orgProblem = (err as Error).message
      console.warn('[sm-linkedin-oauth-callback] organizationAcls failed:', orgProblem)
    }

    if (orgUrn && orgAccount) {
      const orgName = await fetchOrganizationName(token.access_token, orgUrn)
      await adminClient.from('connected_accounts').update({
        external_page_id: orgUrn,
        mode: 'automated',
        status: 'active',
        oauth_connected: true,
        last_sync_error: null,
        ...(orgName ? { account_name: orgName } : {}),
      }).eq('id', orgAccount.id)
      await adminClient.from('connected_account_tokens').upsert({
        account_id: orgAccount.id,
        ...columns,
        linkedin_member_urn: memberUrn,
      }, { onConflict: 'account_id' })
      return toSettings('connected')
    }

    return toSettings('connected_profile_only', orgProblem || 'No Company Page account row found')
  } catch (err) {
    console.error('[sm-linkedin-oauth-callback] failed:', (err as Error).message)
    return toSettings('error', (err as Error).message)
  }
})
