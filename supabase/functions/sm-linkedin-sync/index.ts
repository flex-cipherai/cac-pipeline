// Supabase Edge Function: sm-linkedin-sync — older name of sm-sync, kept so
// existing cron jobs and links keep working. Same code as sm-sync.
// Hourly (pg_cron) analytics + follower + comment sync for every connected
// social account, on every platform with a connector — see
// _shared/socialSync.ts. Body (optional): { force: true } ignores the 6-hour
// stats spacing ("Sync now" in Settings → Integrations).
//
// Deploy: supabase functions deploy sm-linkedin-sync --no-verify-jwt
// Schedule: migration-social-v2-cron.sql

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { runSocialSync } from '../_shared/socialSync.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const body = await req.json().catch(() => ({}))
    const accounts = await runSocialSync(db, body?.force === true)
    return new Response(JSON.stringify({ success: true, accounts }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: (error as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
