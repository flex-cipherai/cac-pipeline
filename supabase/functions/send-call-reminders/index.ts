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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const SENDER_EMAIL = Deno.env.get('SENDER_EMAIL') || 'notifications@sdfmgroup.com'
const SENDER_NAME = 'SDFM Group Limited'
const DEFAULT_REMINDER_HOURS = 24

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function renderTemplate(str: string, vars: Record<string, unknown>) {
  return str.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    const value = vars[key]
    return value === null || value === undefined ? '' : String(value)
  })
}

async function sendViaResend(to: string[], subject: string, html: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: `${SENDER_NAME} <${SENDER_EMAIL}>`,
      to,
      subject,
      html,
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.message || 'Resend API error')
  return data
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (!RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY is not configured. Set it via: supabase secrets set RESEND_API_KEY=re_xxxxx')
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    const { data: settingRow } = await adminClient
      .from('system_settings')
      .select('value')
      .eq('key', 'reminder_hours_before_call')
      .maybeSingle()
    const reminderHours = parseInt(settingRow?.value, 10) || DEFAULT_REMINDER_HOURS
    const reminderMs = reminderHours * 60 * 60 * 1000

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
    // scheduled_date/scheduled_time are treated as UTC wall-clock values —
    // this app doesn't do explicit timezone handling anywhere else either.
    const due = (candidates || []).filter(lead => {
      const scheduledAt = new Date(`${lead.scheduled_date}T${lead.scheduled_time}:00Z`).getTime()
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

    let teamEmails: string[] = []
    if (teamTemplate?.is_active) {
      const { data: staff } = await adminClient.from('profiles').select('email').in('role', ['admin', 'sales'])
      teamEmails = (staff || []).map(p => p.email).filter(Boolean)
    }

    const results = []
    for (const lead of due) {
      const leadResult: Record<string, unknown> = { lead_id: lead.id }

      if (clientTemplate?.is_active && lead.email) {
        try {
          await sendViaResend([lead.email], renderTemplate(clientTemplate.subject, lead), renderTemplate(clientTemplate.body_html, lead))
          leadResult.client = { success: true }
        } catch (err) {
          leadResult.client = { success: false, error: err.message }
        }
      }

      if (teamTemplate?.is_active && teamEmails.length > 0) {
        try {
          await sendViaResend(teamEmails, renderTemplate(teamTemplate.subject, lead), renderTemplate(teamTemplate.body_html, lead))
          leadResult.team = { success: true, recipients: teamEmails.length }
        } catch (err) {
          leadResult.team = { success: false, error: err.message }
        }
      }

      await adminClient.from('leads').update({ reminder_sent_at: new Date().toISOString() }).eq('id', lead.id)
      results.push(leadResult)
    }

    return jsonResponse({ success: true, reminded: results.length, results })
  } catch (error) {
    return jsonResponse({ success: false, error: error.message }, 500)
  }
})
