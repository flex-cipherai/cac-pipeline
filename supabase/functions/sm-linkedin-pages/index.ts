// Supabase Edge Function: sm-linkedin-pages
// Settings → Integrations → "Refresh pages": re-reads the LinkedIn Company
// Pages the signed-in admin administers, using the LinkedIn connection they
// already made (their profile account's token), and adds any missing page
// rows (see _shared/linkedinPages.ts). No LinkedIn sign-in needed.
//
// Body: {} — admin only.
//
// Deploy: supabase functions deploy sm-linkedin-pages

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getValidLinkedInAccessToken } from '../_shared/linkedin.ts'
import { syncAdministeredPages } from '../_shared/linkedinPages.ts'

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
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonResponse({ success: false, error: 'Missing authorization' })

    const anonClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: { user }, error: authError } = await anonClient.auth.getUser()
    if (authError || !user) return jsonResponse({ success: false, error: 'Unauthorized — please sign in again' })

    const db = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: profile } = await db.from('profiles').select('role').eq('id', user.id).single()
    if (profile?.role !== 'admin') return jsonResponse({ success: false, error: 'Admin access required' })

    const { data: member } = await db
      .from('connected_accounts')
      .select('id, external_page_id')
      .eq('account_type', 'member')
      .eq('owner_profile_id', user.id)
      .maybeSingle()
    if (!member) {
      return jsonResponse({ success: false, error: 'Connect LinkedIn first — your LinkedIn connection is used to find your pages' })
    }

    const accessToken = await getValidLinkedInAccessToken(db, member.id)
    const { pages } = await syncAdministeredPages(db, accessToken, { fromAccountId: member.id }, member.external_page_id)
    return jsonResponse({ success: true, pages })
  } catch (err) {
    return jsonResponse({ success: false, error: (err as Error).message || 'Internal server error' })
  }
})
