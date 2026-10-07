// Supabase Edge Function: sm-gsc-sync
// Pulls Google Search Console performance data into the seo_* tables so the
// Website Analytics page can show how people find us through search.
//
//   POST {}                       sync recent data (default: last 7 days; the
//                                 first ever run backfills 90 days)
//   POST { "days": 480 }          sync/backfill a specific number of days (max 480)
//   POST { "action": "list_sites" }   admin only — lists the properties the
//                                 service account can see, to verify setup
//
// Callers
//   - pg_cron, daily, using the public anon key (see
//     migration-website-analytics-cron.sql). Throttled to once per 6 hours so
//     the public anon key cannot be used to hammer the Google API.
//   - Signed-in admin/marketing users via the "Sync now" button (throttled to
//     once per minute).
//
// Setup (one time)
//   1. Google Cloud: enable "Google Search Console API", create a service
//      account, create a JSON key.
//   2. Search Console → Settings → Users and permissions → add the service
//      account's email (client_email in the key) with "Restricted" access.
//   3. supabase secrets set GSC_SERVICE_ACCOUNT_JSON="<key file JSON or base64>"
//   4. Settings → Search Console in the app: enter the property
//      (e.g. sc-domain:sdfmgroup.com or https://sdfmgroup.com/).
//
// Deploy: supabase functions deploy sm-gsc-sync

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAccessToken, listSites, parseServiceAccount, queryAnalytics, syncRange } from '../_shared/searchConsole.ts'

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

const MIN_INTERVAL_USER_MS = 60 * 1000
const MIN_INTERVAL_CRON_MS = 6 * 60 * 60 * 1000
const INITIAL_BACKFILL_DAYS = 90
const DEFAULT_DAYS = 7
const MAX_DAYS = 480
const UPSERT_CHUNK = 1000

// deno-lint-ignore no-explicit-any
async function upsertChunked(client: any, table: string, rows: Record<string, unknown>[], onConflict: string) {
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const { error } = await client.from(table).upsert(rows.slice(i, i + UPSERT_CHUNK), { onConflict })
    if (error) throw new Error(`${table}: ${error.message}`)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    const body = await req.json().catch(() => ({}))

    // Who is calling? A signed-in team member, or the cron job (anon key).
    let callerRole: string | null = null
    const authHeader = req.headers.get('Authorization')
    if (authHeader) {
      const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
      const { data: { user } } = await userClient.auth.getUser()
      if (user) {
        const { data: profile } = await userClient.from('profiles').select('role').eq('id', user.id).single()
        callerRole = profile?.role ?? null
      }
    }
    const isTeamMember = callerRole === 'admin' || callerRole === 'marketing'

    // Service account first: every action needs it.
    let serviceAccount
    try {
      serviceAccount = parseServiceAccount(Deno.env.get('GSC_SERVICE_ACCOUNT_JSON'))
    } catch (err) {
      return jsonResponse({ success: false, code: 'not_configured', error: err.message })
    }

    if (body.action === 'list_sites') {
      if (callerRole !== 'admin') return jsonResponse({ success: false, error: 'Admin access required' })
      const token = await getAccessToken(serviceAccount)
      const sites = await listSites(token)
      return jsonResponse({ success: true, service_account_email: serviceAccount.client_email, sites })
    }

    // Which property to sync (editable in the app; env var is a fallback).
    const { data: settings } = await adminClient
      .from('system_settings').select('key, value')
      .in('key', ['gsc_site_url', 'gsc_last_sync_at'])
    const setting = (k: string) => settings?.find((s: { key: string }) => s.key === k)?.value || ''
    const siteUrl = setting('gsc_site_url') || Deno.env.get('GSC_SITE_URL') || ''
    if (!siteUrl) {
      return jsonResponse({
        success: false,
        code: 'no_site',
        error: 'No Search Console property set — enter it in Settings → Search Console',
        service_account_email: serviceAccount.client_email,
      })
    }

    // Throttle (the cron path is reachable with the public anon key).
    const lastAt = setting('gsc_last_sync_at')
    const minInterval = isTeamMember ? MIN_INTERVAL_USER_MS : MIN_INTERVAL_CRON_MS
    if (lastAt && Date.now() - new Date(lastAt).getTime() < minInterval) {
      return jsonResponse({ success: true, skipped: true, note: 'Synced recently' })
    }

    const { count: existing } = await adminClient.from('seo_daily').select('date', { count: 'exact', head: true })
    const requested = Number(body.days)
    const days = Math.min(MAX_DAYS, Number.isFinite(requested) && requested > 0
      ? Math.floor(requested)
      : (existing ? DEFAULT_DAYS : INITIAL_BACKFILL_DAYS))
    const { startDate, endDate } = syncRange(days)

    const recordStatus = async (status: string) => {
      await adminClient.from('system_settings').upsert([
        { key: 'gsc_last_sync_at', value: new Date().toISOString() },
        { key: 'gsc_last_sync_status', value: status },
      ], { onConflict: 'key' })
    }

    try {
      const token = await getAccessToken(serviceAccount)

      // Run sequentially: four modest calls, and the API rate-limits bursts.
      const daily = await queryAnalytics(token, siteUrl, { startDate, endDate, dimensions: ['date'] })
      const queries = await queryAnalytics(token, siteUrl, { startDate, endDate, dimensions: ['date', 'query', 'page'] })
      const countries = await queryAnalytics(token, siteUrl, { startDate, endDate, dimensions: ['date', 'country'] })
      const devices = await queryAnalytics(token, siteUrl, { startDate, endDate, dimensions: ['date', 'device'] })

      await upsertChunked(adminClient, 'seo_daily', daily.map(r => ({
        date: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position,
        synced_at: new Date().toISOString(),
      })), 'date')

      await upsertChunked(adminClient, 'seo_queries', queries.map(r => ({
        date: r.keys[0], query: r.keys[1], page: r.keys[2],
        clicks: r.clicks, impressions: r.impressions, position: r.position,
      })), 'date,query,page')

      await upsertChunked(adminClient, 'seo_dimension_daily', [
        ...countries.map(r => ({ date: r.keys[0], dimension: 'country', value: r.keys[1], clicks: r.clicks, impressions: r.impressions, position: r.position })),
        ...devices.map(r => ({ date: r.keys[0], dimension: 'device', value: r.keys[1], clicks: r.clicks, impressions: r.impressions, position: r.position })),
      ], 'date,dimension,value')

      await recordStatus('ok')
      return jsonResponse({
        success: true,
        site: siteUrl,
        range: { startDate, endDate },
        rows: { daily: daily.length, queries: queries.length, countries: countries.length, devices: devices.length },
      })
    } catch (err) {
      await recordStatus(`error: ${err.message}`.slice(0, 300))
      return jsonResponse({ success: false, code: 'sync_failed', error: err.message })
    }
  } catch (err) {
    return jsonResponse({ success: false, error: err.message || 'Internal server error' })
  }
})
