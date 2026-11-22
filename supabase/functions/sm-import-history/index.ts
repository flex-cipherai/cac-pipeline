// Supabase Edge Function: sm-import-history
// Settings → Integrations → "Import history": pulls up to 12 months of an
// account's daily totals and follower trend, and its past posts (Company
// Pages) with lifetime stats — see _shared/socialHistory.ts. Safe to run
// again: daily rows are upserted and known posts are skipped.
//
// Body: { account_id }  — caller must be an admin or have Analytics access.
//
// Deploy: supabase functions deploy sm-import-history

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { userHasModule } from '../_shared/access.ts'
import { hasConnector } from '../_shared/platforms/index.ts'
import { importHistory } from '../_shared/socialHistory.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonResponse({ success: false, error: 'Missing authorization' })
    const anon = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } })
    const { data: { user } } = await anon.auth.getUser()
    if (!user) return jsonResponse({ success: false, error: 'Unauthorized — please sign in again' })

    const db = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    if (!(await userHasModule(db, user.id, 'social_analytics', ['admin', 'marketing']))) {
      return jsonResponse({ success: false, error: 'You do not have access to Analytics' })
    }

    const { account_id } = await req.json().catch(() => ({}))
    const { data: account } = await db.from('connected_accounts').select('*').eq('id', account_id).maybeSingle()
    if (!account) return jsonResponse({ success: false, error: 'Account not found' })
    if (account.mode !== 'automated' || !account.external_page_id || !hasConnector(account.platform)) {
      return jsonResponse({ success: false, error: `${account.account_name} is not connected through its API` })
    }
    if (account.account_type === 'member' && account.owner_profile_id !== user.id) {
      return jsonResponse({ success: false, error: 'Only the owner of a profile can import its history' })
    }

    const result = await importHistory(db, account)
    return jsonResponse({ success: true, ...result })
  } catch (err) {
    return jsonResponse({ success: false, error: (err as Error).message || 'Internal server error' })
  }
})
