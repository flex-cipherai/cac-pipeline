// Supabase Edge Function: send-pipeline-alerts
// Flags active leads in the sales pipeline that have had no logged interaction for 48 hours and tells the
// admins: one email per run listing every newly stale lead, plus an entry in each admin's notification bell.
//
// A lead is alerted once per quiet spell (stale_alerted_at); logging an interaction starts a new spell.
// Emails go out between 08:00 and 18:00 team time (the team_timezone setting); a lead that goes stale at
// night is reported in the next working hour. The rules are in _shared/pipelineAlerts.ts.
//
// Meant to be called hourly by pg_cron (migration-sales-pipeline-cron.sql), not from the app.
// Deploy: supabase functions deploy send-pipeline-alerts --no-verify-jwt
// Needs the same secrets as the other reminder functions: RESEND_API_KEY, SENDER_EMAIL.
// Call with {"force":true} to ignore working hours (for testing).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { renderTemplate, requireResendKey, sendViaResend } from '../_shared/resend.ts'
import { DEFAULT_TIMEZONE } from '../_shared/datetime.ts'
import { localHour, WORK_END_HOUR, WORK_START_HOUR } from '../_shared/inquiryReminders.ts'
import { itemsHtml, needsAlert, summaryText, type PipelineLead } from '../_shared/pipelineAlerts.ts'

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
    const body = await req.json().catch(() => ({}))
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const now = new Date()

    const { data: settingRows } = await admin
      .from('system_settings').select('key, value').in('key', ['team_timezone', 'app_base_url'])
    const setting = (key: string) => settingRows?.find((r: { key: string }) => r.key === key)?.value
    const timeZone = setting('team_timezone') || DEFAULT_TIMEZONE
    const appBase = (setting('app_base_url') || 'https://spm.sdfmgroup.com').replace(/\/+$/, '')

    const hour = localHour(now, timeZone)
    if (body?.force !== true && (hour < WORK_START_HOUR || hour >= WORK_END_HOUR)) {
      return jsonResponse({ success: true, skipped: 'outside working hours', hour })
    }

    const { data: leads, error } = await admin
      .from('pipeline_leads')
      .select('id, full_name, company_name, stage, entry_point, source_channel, owner_id, created_at, last_interaction_at, stale_alerted_at')
      .eq('stage', 'active')
    if (error) return jsonResponse({ success: false, error: error.message }, 500)

    const due = ((leads || []) as PipelineLead[])
      .filter(l => needsAlert(l, now))
      .sort((a, b) => (a.last_interaction_at || a.created_at).localeCompare(b.last_interaction_at || b.created_at))
    if (due.length === 0) return jsonResponse({ success: true, alerted: 0 })

    // "The admin": every active admin account.
    const { data: profiles } = await admin.from('profiles').select('id, name, email, role, is_active')
    const all = (profiles || []) as { id: string; name: string; email: string; role: string; is_active: boolean | null }[]
    const admins = all.filter(p => p.role === 'admin' && p.is_active !== false)
    const owners = Object.fromEntries(all.map(p => [p.id, p.name]))
    if (admins.length === 0) return jsonResponse({ success: true, alerted: 0, note: 'no active admins' })

    const { data: template } = await admin
      .from('email_templates').select('*').eq('template_key', 'pipeline_lead_stale').maybeSingle()
    let emailReady = false
    let emailProblem: string | null = null
    if (template?.is_active) {
      try { requireResendKey(); emailReady = true } catch (e) { emailProblem = (e as Error).message }
    }

    const html = itemsHtml(due, now, appBase, owners)
    let delivered = false
    const results: Record<string, unknown>[] = []
    for (const a of admins) {
      const result: Record<string, unknown> = { user_id: a.id }
      const { error: bellError } = await admin.from('in_app_notifications').insert({
        user_id: a.id,
        type: 'pipeline_lead_stale',
        title: `${due.length} pipeline ${due.length === 1 ? 'lead has' : 'leads have'} had no contact for 48 hours`,
        body: summaryText(due),
        link: '/pipeline?filter=attention',
      })
      result.in_app = !bellError
      if (!bellError) delivered = true

      if (emailReady && a.email) {
        const vars = {
          recipient_name: (a.name || '').split(' ')[0] || 'there',
          total_count: due.length,
          items_html: html,
          app_link: `${appBase}/pipeline?filter=attention`,
        }
        try {
          await sendViaResend([a.email], renderTemplate(template.subject, vars), renderTemplate(template.body_html, vars))
          result.email = true
          delivered = true
        } catch (e) {
          result.email = false
          result.email_error = (e as Error).message
        }
      }
      results.push(result)
    }

    // Stamp only when it reached someone, so a failed run is retried by the next one.
    if (delivered) {
      const { error: stampError } = await admin
        .from('pipeline_leads').update({ stale_alerted_at: now.toISOString() }).in('id', due.map(l => l.id))
      if (stampError) console.error('[send-pipeline-alerts] could not stamp leads', stampError.message)
    }

    return jsonResponse({
      success: true, alerted: due.length, stamped: delivered,
      email: template?.is_active ? (emailReady ? 'sent' : `skipped: ${emailProblem}`) : 'template inactive or missing',
      results,
    })
  } catch (error) {
    return jsonResponse({ success: false, error: (error as Error).message }, 500)
  }
})
