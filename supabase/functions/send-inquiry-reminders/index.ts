// Supabase Edge Function: send-inquiry-reminders
// Tells the team about inquiries that need them, by email and in the in-app notification bell.
//
//   {"mode":"daily"}    follow-ups due today or tomorrow, and inquiries that have gone quiet
//   {"mode":"replies"}  new inquiries nobody has answered for 24 hours (working hours only)
//
// Each person gets one email per run listing their inquiries: the owner's, or everyone's when an
// inquiry has no owner. Who counts as "someone who can use inquiries" follows Settings → Permissions.
// A reminder is stamped on the inquiry once delivered so it is never sent twice; see
// _shared/inquiryReminders.ts for the rules and migration-inquiry-reminders.sql for the columns.
//
// Meant to be called by pg_cron (migration-inquiry-reminders-cron.sql), not from the app.
// Deploy: supabase functions deploy send-inquiry-reminders --no-verify-jwt
// Needs the same secrets as send-email: RESEND_API_KEY, SENDER_EMAIL

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { renderTemplate, requireResendKey, sendViaResend } from '../_shared/resend.ts'
import { DEFAULT_TIMEZONE } from '../_shared/datetime.ts'
import { staffWithModule } from '../_shared/access.ts'
import {
  OPEN_STATUSES, REPLY_TARGET_HOURS, countByKind, itemsHtml, planDaily, planReplyAlerts, stampFor, summaryText,
  type Digest, type Inquiry, type Recipient,
} from '../_shared/inquiryReminders.ts'

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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json().catch(() => ({}))
    const mode: 'daily' | 'replies' = body?.mode === 'replies' ? 'replies' : 'daily'
    const templateKey = mode === 'daily' ? 'inquiry_reminder_daily' : 'inquiry_reply_overdue'

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const now = new Date()

    const { data: settingRows } = await admin
      .from('system_settings').select('key, value').in('key', ['team_timezone', 'app_base_url'])
    const setting = (key: string) => settingRows?.find(r => r.key === key)?.value
    const timeZone = setting('team_timezone') || DEFAULT_TIMEZONE
    const appLink = `${(setting('app_base_url') || 'https://spm.sdfmgroup.com').replace(/\/+$/, '')}/inquiries`

    // Who can use inquiries: admin always, plus any role switched on in Settings → Permissions
    // (original rule, admin and sales, if the permissions table is not there yet).
    const recipients: Recipient[] = await staffWithModule(admin, 'inquiries', ['admin', 'sales'])
    if (recipients.length === 0) return jsonResponse({ success: true, mode, digests: 0, note: 'no eligible recipients' })

    const { data: inquiries, error: inquiriesError } = await admin
      .from('inquiries').select('*').in('status', OPEN_STATUSES)
    if (inquiriesError) return jsonResponse({ success: false, error: inquiriesError.message }, 500)

    const digests: Digest[] = mode === 'daily'
      ? planDaily((inquiries || []) as Inquiry[], recipients, now, timeZone)
      : planReplyAlerts((inquiries || []) as Inquiry[], recipients, now, timeZone)
    if (digests.length === 0) return jsonResponse({ success: true, mode, digests: 0 })

    const { data: template } = await admin
      .from('email_templates').select('*').eq('template_key', templateKey).maybeSingle()

    let emailReady = false
    let emailProblem: string | null = null
    if (template?.is_active) {
      try { requireResendKey(); emailReady = true } catch (e) { emailProblem = (e as Error).message }
    }

    // item key -> stamp, collected from digests that actually reached someone
    const toStamp = new Map<string, { id: string; patch: Record<string, string | null> }>()
    const results: Record<string, unknown>[] = []

    for (const digest of digests) {
      const { recipient, items } = digest
      const counts = countByKind(items)
      const total = items.length
      const result: Record<string, unknown> = { user_id: recipient.id, items: total }
      let delivered = false

      const { error: notifError } = await admin.from('in_app_notifications').insert({
        user_id: recipient.id,
        type: mode === 'daily' ? 'inquiry_reminder' : 'inquiry_reply_overdue',
        title: `${total} ${total === 1 ? 'inquiry needs' : 'inquiries need'} you`,
        body: summaryText(items),
        link: '/inquiries',
      })
      result.in_app = !notifError
      if (!notifError) delivered = true

      if (emailReady && recipient.email) {
        const vars = {
          recipient_name: (recipient.name || '').split(' ')[0] || 'there',
          total_count: total,
          follow_up_due_count: counts.follow_up_due,
          follow_up_tomorrow_count: counts.follow_up_tomorrow,
          gone_quiet_count: counts.gone_quiet,
          reply_target_hours: REPLY_TARGET_HOURS,
          items_html: itemsHtml(items, now, timeZone),
          app_link: appLink,
        }
        try {
          await sendViaResend([recipient.email], renderTemplate(template.subject, vars), renderTemplate(template.body_html, vars))
          result.email = true
          delivered = true
        } catch (e) {
          result.email = false
          result.email_error = (e as Error).message
        }
      }

      // Stamp only what reached someone, so a failed run is retried by the next one.
      if (delivered) {
        for (const item of items) {
          toStamp.set(`${item.inquiry.id}:${item.kind}`, { id: item.inquiry.id, patch: stampFor(item, now, timeZone) })
        }
      }
      results.push(result)
    }

    // One update per inquiry: an inquiry can carry more than one kind (e.g. due today and gone quiet).
    const patchesById = new Map<string, Record<string, string | null>>()
    for (const { id, patch } of toStamp.values()) patchesById.set(id, { ...(patchesById.get(id) || {}), ...patch })
    for (const [id, patch] of patchesById) {
      const { error } = await admin.from('inquiries').update(patch).eq('id', id)
      if (error) console.error('[send-inquiry-reminders] could not stamp inquiry', id, error.message)
    }

    return jsonResponse({
      success: true, mode, digests: digests.length, stamped: patchesById.size,
      email: template?.is_active ? (emailReady ? 'sent' : `skipped: ${emailProblem}`) : 'template inactive or missing',
      results,
    })
  } catch (error) {
    return jsonResponse({ success: false, error: (error as Error).message }, 500)
  }
})
