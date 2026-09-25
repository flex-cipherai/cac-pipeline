// Supabase Edge Function: send-follow-up-reminders
// Checks for leads whose follow_up_date is tomorrow or today and haven't
// been reminded yet for that date, and notifies admin/sales by email (if
// the relevant template is active) and via the in-app notification bell.
// Meant to be invoked on a schedule (see migration-follow-up-reminders.sql
// for the pg_cron job) rather than from the app directly.
//
// Deploy: supabase functions deploy send-follow-up-reminders --no-verify-jwt
// Requires the same secrets as send-email: RESEND_API_KEY, SENDER_EMAIL

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { DateTime } from 'https://esm.sh/luxon@3.5.0'
import { renderTemplate, requireResendKey, sendViaResend } from '../_shared/resend.ts'
import { DEFAULT_TIMEZONE } from '../_shared/datetime.ts'

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

    const { data: teamTzRow } = await adminClient
      .from('system_settings').select('value').eq('key', 'team_timezone').maybeSingle()
    const teamTimezone = teamTzRow?.value || DEFAULT_TIMEZONE

    const today = DateTime.now().setZone(teamTimezone).toISODate()
    const tomorrow = DateTime.now().setZone(teamTimezone).plus({ days: 1 }).toISODate()

    const { data: candidates, error: candidatesError } = await adminClient
      .from('leads')
      .select('*')
      .in('follow_up_date', [today, tomorrow])

    if (candidatesError) {
      return jsonResponse({ success: false, error: candidatesError.message }, 500)
    }

    const active = (candidates || []).filter(l => !l.is_lost && !l.is_disqualified)
    const before = active.filter(l => l.follow_up_date === tomorrow && l.follow_up_reminder_before_sent_for !== tomorrow)
    const due = active.filter(l => l.follow_up_date === today && l.follow_up_reminder_due_sent_for !== today)

    if (before.length === 0 && due.length === 0) {
      return jsonResponse({ success: true, reminded: 0 })
    }

    const { data: templates } = await adminClient
      .from('email_templates')
      .select('*')
      .in('template_key', ['follow_up_reminder_before', 'follow_up_reminder_due'])

    const beforeTemplate = templates?.find(t => t.template_key === 'follow_up_reminder_before')
    const dueTemplate = templates?.find(t => t.template_key === 'follow_up_reminder_due')

    const { data: staff } = await adminClient.from('profiles').select('id, email').in('role', ['admin', 'sales'])
    const recipients = (staff || []).filter(p => p.email)

    function formatFollowUp(dateStr: string) {
      return DateTime.fromISO(dateStr, { zone: teamTimezone }).toFormat('cccc, d LLLL yyyy')
    }

    async function notify(
      leads: Record<string, any>[],
      template: Record<string, any> | undefined,
      sentForColumn: string,
      sentForValue: string,
      title: (lead: Record<string, any>) => string,
      body: (lead: Record<string, any>) => string,
    ) {
      const results = []
      for (const lead of leads) {
        const leadResult: Record<string, unknown> = { lead_id: lead.id }
        const vars = { ...lead, follow_up_date: formatFollowUp(lead.follow_up_date) }

        if (recipients.length > 0) {
          if (template?.is_active) {
            const sends = await Promise.allSettled(recipients.map(p =>
              sendViaResend([p.email], renderTemplate(template.subject, vars), renderTemplate(template.body_html, vars))
            ))
            const failed = sends.filter(s => s.status === 'rejected').length
            leadResult.email = { success: failed === 0, recipients: recipients.length, failed }
          }

          const { error: notifError } = await adminClient.from('in_app_notifications').insert(
            recipients.map(p => ({
              user_id: p.id,
              type: 'follow_up_reminder',
              title: title(lead),
              body: body(lead),
              link: '/leads',
            }))
          )
          leadResult.in_app = { success: !notifError }
        }

        await adminClient.from('leads').update({ [sentForColumn]: sentForValue }).eq('id', lead.id)
        results.push(leadResult)
      }
      return results
    }

    const beforeResults = await notify(
      before, beforeTemplate, 'follow_up_reminder_before_sent_for', tomorrow,
      lead => `Follow-up Tomorrow: ${lead.full_name} (${lead.company_name})`,
      lead => `Follow-up with ${lead.company_name} is due tomorrow.`,
    )
    const dueResults = await notify(
      due, dueTemplate, 'follow_up_reminder_due_sent_for', today,
      lead => `Follow-up Due Today: ${lead.full_name} (${lead.company_name})`,
      lead => `Follow-up with ${lead.company_name} is due today.`,
    )

    return jsonResponse({ success: true, reminded: beforeResults.length + dueResults.length, before: beforeResults, due: dueResults })
  } catch (error) {
    return jsonResponse({ success: false, error: error.message }, 500)
  }
})
