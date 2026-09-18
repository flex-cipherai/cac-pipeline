// Supabase Edge Function: send-call-reminders
// Checks for leads with an upcoming Scheduled discovery call that falls
// inside the configured reminder window and haven't been reminded yet, and
// sends the client + team reminder emails. Meant to be invoked on a
// schedule (see migration-call-reminders.sql for the pg_cron job) rather
// than from the app directly.
//
// Deploy: supabase functions deploy send-call-reminders --no-verify-jwt
// Requires the same secrets as send-email: RESEND_API_KEY, SENDER_EMAIL

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { DateTime } from 'https://esm.sh/luxon@3.5.0'
import { renderTemplate, requireResendKey, sendViaResend } from '../_shared/resend.ts'
import { DEFAULT_TIMEZONE, leadVars } from '../_shared/datetime.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const DEFAULT_REMINDER_HOURS = 24

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

    const { data: settingsRows } = await adminClient
      .from('system_settings')
      .select('key, value')
      .in('key', ['reminder_hours_before_call', 'team_timezone'])
    const settings: Record<string, string> = {}
    ;(settingsRows || []).forEach(r => { settings[r.key] = r.value })

    const reminderHours = parseInt(settings.reminder_hours_before_call, 10) || DEFAULT_REMINDER_HOURS
    const reminderMs = reminderHours * 60 * 60 * 1000
    const teamTimezone = settings.team_timezone || DEFAULT_TIMEZONE

    const { data: candidates, error: candidatesError } = await adminClient
      .from('leads')
      .select('*')
      .eq('current_stage', 'Scheduled')
      .is('reminder_sent_at', null)
      .not('scheduled_date', 'is', null)
      .not('scheduled_time', 'is', null)

    if (candidatesError) {
      return jsonResponse({ success: false, error: candidatesError.message }, 500)
    }

    const now = Date.now()
    // scheduled_date/scheduled_time are a wall-clock reading in team_timezone.
    const due = (candidates || []).filter(lead => {
      const scheduledAt = DateTime.fromISO(`${lead.scheduled_date}T${lead.scheduled_time}`, { zone: teamTimezone }).toMillis()
      return scheduledAt > now && scheduledAt - now <= reminderMs
    })

    if (due.length === 0) {
      return jsonResponse({ success: true, reminded: 0 })
    }

    const { data: templates } = await adminClient
      .from('email_templates')
      .select('*')
      .in('template_key', ['discovery_call_reminder_client', 'discovery_call_reminder_team'])

    const clientTemplate = templates?.find(t => t.template_key === 'discovery_call_reminder_client')
    const teamTemplate = templates?.find(t => t.template_key === 'discovery_call_reminder_team')

    // Neither reminder is active yet — leave reminder_sent_at untouched so
    // these leads still get reminded once a template is activated, rather
    // than silently "using up" their reminder window while nothing sends.
    if (!clientTemplate?.is_active && !teamTemplate?.is_active) {
      return jsonResponse({ success: true, reminded: 0, note: 'No active reminder templates' })
    }

    let recipients: { email: string; timezone: string | null }[] = []
    if (teamTemplate?.is_active) {
      const { data: staff } = await adminClient.from('profiles').select('email, timezone').in('role', ['admin', 'sales'])
      recipients = (staff || []).filter(p => p.email)
    }

    const results = []
    for (const lead of due) {
      const leadResult: Record<string, unknown> = { lead_id: lead.id }
      const leadTimezone = lead.timezone || teamTimezone

      if (clientTemplate?.is_active && lead.email) {
        try {
          const vars = leadVars(lead, teamTimezone, leadTimezone)
          await sendViaResend([lead.email], renderTemplate(clientTemplate.subject, vars), renderTemplate(clientTemplate.body_html, vars))
          leadResult.client = { success: true }
        } catch (err) {
          leadResult.client = { success: false, error: err.message }
        }
      }

      if (teamTemplate?.is_active && recipients.length > 0) {
        const sends = await Promise.allSettled(recipients.map(p => {
          const vars = leadVars(lead, teamTimezone, p.timezone || teamTimezone)
          return sendViaResend([p.email], renderTemplate(teamTemplate.subject, vars), renderTemplate(teamTemplate.body_html, vars))
        }))
        const failed = sends.filter(s => s.status === 'rejected').length
        leadResult.team = { success: failed === 0, recipients: recipients.length, failed }
      }

      await adminClient.from('leads').update({ reminder_sent_at: new Date().toISOString() }).eq('id', lead.id)
      results.push(leadResult)
    }

    return jsonResponse({ success: true, reminded: results.length, results })
  } catch (error) {
    return jsonResponse({ success: false, error: error.message }, 500)
  }
})
