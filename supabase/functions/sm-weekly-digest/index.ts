// Supabase Edge Function: sm-weekly-digest
// Aggregates the last 7 days of analytics_snapshots and emails the digest
// template to the content team. Meant to be invoked on a weekly schedule
// (see migration-social-scheduler-cron.sql) rather than from the app.
//
// Deploy: supabase functions deploy sm-weekly-digest --no-verify-jwt
// Requires the same secrets as send-email: RESEND_API_KEY, SENDER_EMAIL

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { renderTemplate, requireResendKey, sendViaResend } from '../_shared/resend.ts'

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
    requireResendKey()

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    const { data: template } = await adminClient
      .from('email_templates').select('*').eq('template_key', 'sm_weekly_digest').maybeSingle()

    if (!template?.is_active) {
      return jsonResponse({ success: true, note: 'Template inactive' })
    }

    const now = new Date()
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

    // Account-level snapshots (post_id is null) in the window
    const { data: accountSnapshots } = await adminClient
      .from('analytics_snapshots')
      .select('impressions, reactions, comments, shares, follower_count, captured_at')
      .is('post_id', null)
      .gte('captured_at', weekAgo.toISOString())
      .order('captured_at', { ascending: true })

    const totalImpressions = (accountSnapshots || []).reduce((sum, s) => sum + (s.impressions || 0), 0)
    const totalEngagement = (accountSnapshots || []).reduce((sum, s) => sum + (s.reactions || 0) + (s.comments || 0) + (s.shares || 0), 0)

    const followerCounts = (accountSnapshots || []).filter(s => s.follower_count != null)
    const followerGrowth = followerCounts.length >= 2
      ? followerCounts[followerCounts.length - 1].follower_count - followerCounts[0].follower_count
      : 0

    // Top post by impressions in the window (post-level snapshots)
    const { data: postSnapshots } = await adminClient
      .from('analytics_snapshots')
      .select('impressions, posts(caption)')
      .not('post_id', 'is', null)
      .gte('captured_at', weekAgo.toISOString())
      .order('impressions', { ascending: false })
      .limit(1)

    const topPost = postSnapshots && postSnapshots.length > 0 ? postSnapshots[0] : null
    const topPostCaption = (topPost as any)?.posts?.caption
      ? String((topPost as any).posts.caption).slice(0, 100)
      : 'No posts published this week'

    const { data: baseUrlRow } = await adminClient
      .from('system_settings').select('value').eq('key', 'app_base_url').maybeSingle()
    const appUrl = (baseUrlRow?.value || '').replace(/\/$/, '')

    const vars = {
      week_range: `${weekAgo.toLocaleDateString('en-GB')} – ${now.toLocaleDateString('en-GB')}`,
      total_impressions: String(totalImpressions),
      total_engagement: String(totalEngagement),
      follower_growth: followerGrowth >= 0 ? `+${followerGrowth}` : String(followerGrowth),
      top_post_caption: topPostCaption,
      dashboard_link: `${appUrl}/social/analytics`,
    }

    const { data: recipients } = await adminClient
      .from('profiles').select('email').in('role', ['admin', 'marketing']).neq('is_active', false)

    const validRecipients = (recipients || []).filter(r => r.email)
    if (validRecipients.length === 0) {
      return jsonResponse({ success: true, emailed: 0, note: 'No recipients' })
    }

    const sends = await Promise.allSettled(
      validRecipients.map(r => sendViaResend([r.email], renderTemplate(template.subject, vars), renderTemplate(template.body_html, vars)))
    )
    const failed = sends.filter(s => s.status === 'rejected').length

    return jsonResponse({ success: true, emailed: validRecipients.length - failed, failed })
  } catch (error) {
    return jsonResponse({ success: false, error: error.message }, 500)
  }
})
