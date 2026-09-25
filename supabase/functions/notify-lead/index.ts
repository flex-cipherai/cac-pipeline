// Supabase Edge Function: notify-lead
// Sends the client confirmation/thank-you email and the team "new lead" alert
// for a just-submitted lead. Runs server-side with the service role key so it
// can read email_templates and profiles regardless of the caller's RLS access
// (the public /intake form submits as anon, which can't read either table).
//
// Deploy: supabase functions deploy notify-lead
// Requires the same secrets as send-email: RESEND_API_KEY, SENDER_EMAIL

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { renderTemplate, requireResendKey, sendViaResend } from '../_shared/resend.ts'
import { DEFAULT_TIMEZONE, leadVars } from '../_shared/datetime.ts'

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

    const { lead_id, team_only } = await req.json()
    if (!lead_id) {
      return jsonResponse({ success: false, error: 'Missing lead_id' }, 400)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    const { data: lead, error: leadError } = await adminClient
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single()

    if (leadError || !lead) {
      return jsonResponse({ success: false, error: leadError?.message || 'Lead not found' }, 404)
    }

    const { data: teamTzRow } = await adminClient
      .from('system_settings').select('value').eq('key', 'team_timezone').maybeSingle()
    const teamTimezone = teamTzRow?.value || DEFAULT_TIMEZONE
    const leadTimezone = lead.timezone || teamTimezone

    const clientTemplateKey = lead.classification === 'cold' ? 'cold_rejection' : 'call_confirmed'

    const { data: templates, error: templatesError } = await adminClient
      .from('email_templates')
      .select('*')
      .in('template_key', [clientTemplateKey, 'new_lead_alert'])

    if (templatesError) {
      return jsonResponse({ success: false, error: templatesError.message }, 500)
    }

    const clientTemplate = templates?.find(t => t.template_key === clientTemplateKey)
    const teamTemplate = templates?.find(t => t.template_key === 'new_lead_alert')

    const results: Record<string, unknown> = {}

    if (!team_only && clientTemplate?.is_active && lead.email) {
      try {
        const vars = leadVars(lead, teamTimezone, leadTimezone)
        await sendViaResend([lead.email], renderTemplate(clientTemplate.subject, vars), renderTemplate(clientTemplate.body_html, vars))
        results.client = { success: true }
      } catch (err) {
        results.client = { success: false, error: err.message }
      }
    }

    if (teamTemplate?.is_active) {
      const { data: staff, error: staffError } = await adminClient
        .from('profiles')
        .select('email, timezone')
        .in('role', ['admin', 'sales'])

      const recipients = (staff || []).filter(p => p.email)

      if (!staffError && recipients.length > 0) {
        const sends = await Promise.allSettled(recipients.map(p => {
          const vars = leadVars(lead, teamTimezone, p.timezone || teamTimezone)
          return sendViaResend([p.email], renderTemplate(teamTemplate.subject, vars), renderTemplate(teamTemplate.body_html, vars))
        }))
        const failed = sends.filter(s => s.status === 'rejected').length
        results.team = { success: failed === 0, recipients: recipients.length, failed }
      } else {
        results.team = { success: false, error: staffError?.message || 'No admin/sales recipients found' }
      }
    }

    return jsonResponse({ success: true, results })
  } catch (error) {
    return jsonResponse({ success: false, error: error.message }, 500)
  }
})
