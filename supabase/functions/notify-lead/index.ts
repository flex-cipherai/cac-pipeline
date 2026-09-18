// Supabase Edge Function: notify-lead
// Sends the client confirmation/thank-you email and the team "new lead" alert
// for a just-submitted lead. Runs server-side with the service role key so it
// can read email_templates and profiles regardless of the caller's RLS access
// (the public /intake form submits as anon, which can't read either table).
//
// Deploy: supabase functions deploy notify-lead
// Requires the same secrets as send-email: RESEND_API_KEY, SENDER_EMAIL

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const SENDER_EMAIL = Deno.env.get('SENDER_EMAIL') || 'notifications@sdfmgroup.com'
const SENDER_NAME = 'SDFM Group Limited'

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

    const { lead_id } = await req.json()
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

    if (clientTemplate?.is_active && lead.email) {
      try {
        await sendViaResend(
          [lead.email],
          renderTemplate(clientTemplate.subject, lead),
          renderTemplate(clientTemplate.body_html, lead)
        )
        results.client = { success: true }
      } catch (err) {
        results.client = { success: false, error: err.message }
      }
    }

    if (teamTemplate?.is_active) {
      const { data: staff, error: staffError } = await adminClient
        .from('profiles')
        .select('email')
        .in('role', ['admin', 'sales'])

      const teamEmails = (staff || []).map(p => p.email).filter(Boolean)

      if (!staffError && teamEmails.length > 0) {
        try {
          await sendViaResend(
            teamEmails,
            renderTemplate(teamTemplate.subject, lead),
            renderTemplate(teamTemplate.body_html, lead)
          )
          results.team = { success: true, recipients: teamEmails.length }
        } catch (err) {
          results.team = { success: false, error: err.message }
        }
      } else {
        results.team = { success: false, error: staffError?.message || 'No admin/sales recipients found' }
      }
    }

    return jsonResponse({ success: true, results })
  } catch (error) {
    return jsonResponse({ success: false, error: error.message }, 500)
  }
})
