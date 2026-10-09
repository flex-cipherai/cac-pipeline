// Emails sent by the booking flow: the client's confirmation, the team's
// "new lead" alert, and the "finish booking" nudge. Templates live in the
// email_templates table (editable on the Notifications page); this only fills
// in the variables and sends.

import { renderTemplate, requireResendKey, sendViaResend } from './resend.ts'
import { leadVars } from './datetime.ts'
import type { BookingSettings } from './booking.ts'
import { googleCalendarLink, prepLink, resumeLink, whatsappLink } from './booking.ts'

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Extra template variables used by booking_confirmed / booking_nudge_client.
export function bookingVars(lead: any, cfg: BookingSettings) {
  const vars = leadVars(lead, cfg.team_timezone, lead.timezone || cfg.team_timezone) as Record<string, unknown>
  vars.duration_minutes = cfg.booking_duration_minutes
  vars.prep_link = prepLink(lead)
  vars.resume_link = resumeLink(lead)
  vars.whatsapp_link = whatsappLink(cfg)
  vars.calendar_link = lead.scheduled_date ? googleCalendarLink(cfg, lead) : ''
  vars.meeting_details = cfg.meeting_link
    ? `<p style="margin: 8px 0 0; font-size: 14px;"><strong>Where:</strong> <a href="${escapeHtml(cfg.meeting_link)}" style="color: #C9260C; font-weight: 700;">Join on Google Meet</a></p>`
    : `<p style="margin: 8px 0 0; font-size: 14px;"><strong>Where:</strong> Google Meet. We will email you the link before the call.</p>`
  return vars
}

async function loadTemplates(admin: any, keys: string[]) {
  const { data } = await admin.from('email_templates').select('*').in('template_key', keys)
  const map: Record<string, any> = {}
  ;(data || []).forEach((t: any) => { map[t.template_key] = t })
  return map
}

// Client confirmation + team alert for a freshly booked call.
export async function sendBookingEmails(admin: any, lead: any, cfg: BookingSettings) {
  requireResendKey()
  const results: Record<string, unknown> = {}
  const templates = await loadTemplates(admin, ['booking_confirmed', 'call_confirmed', 'new_lead_alert'])

  const clientTemplate = templates.booking_confirmed?.is_active ? templates.booking_confirmed
    : templates.call_confirmed?.is_active ? templates.call_confirmed
    : null

  if (clientTemplate && lead.email) {
    try {
      const vars = bookingVars(lead, cfg)
      await sendViaResend([lead.email], renderTemplate(clientTemplate.subject, vars), renderTemplate(clientTemplate.body_html, vars))
      results.client = { success: true, template: clientTemplate.template_key }
    } catch (err) {
      results.client = { success: false, error: (err as Error).message }
    }
  }

  const teamTemplate = templates.new_lead_alert
  if (teamTemplate?.is_active) {
    const { data: staff, error } = await admin.from('profiles').select('email, timezone').in('role', ['admin', 'sales'])
    const recipients = (staff || []).filter((p: any) => p.email)
    if (!error && recipients.length > 0) {
      const sends = await Promise.allSettled(recipients.map((p: any) => {
        const vars = leadVars(lead, cfg.team_timezone, p.timezone || cfg.team_timezone)
        return sendViaResend([p.email], renderTemplate(teamTemplate.subject, vars), renderTemplate(teamTemplate.body_html, vars))
      }))
      const failed = sends.filter(s => s.status === 'rejected').length
      results.team = { success: failed === 0, recipients: recipients.length, failed }
    }
  }
  return results
}

// "You didn't pick a time" email. Returns false when the template is off.
export async function sendNudgeEmail(admin: any, lead: any, cfg: BookingSettings, template?: any) {
  requireResendKey()
  const tmpl = template || (await loadTemplates(admin, ['booking_nudge_client'])).booking_nudge_client
  if (!tmpl?.is_active || !lead.email) return false
  const vars = bookingVars(lead, cfg)
  await sendViaResend([lead.email], renderTemplate(tmpl.subject, vars), renderTemplate(tmpl.body_html, vars))
  return true
}
