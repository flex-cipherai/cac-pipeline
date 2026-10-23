// Emails sent by the booking flow: the client's confirmation, the team's
// "new lead" alert, and the "finish booking" nudge. Templates live in the
// email_templates table (editable on the Notifications page); this only fills
// in the variables and sends.

import { DateTime } from 'https://esm.sh/luxon@3.5.0'
import { renderTemplate, requireResendKey, sendViaResend } from './resend.ts'
import { leadVars } from './datetime.ts'
import { staffWithModule } from './access.ts'
import type { BookingSettings } from './booking.ts'
import { googleCalendarLink, slotInstant, whatsappLink } from './booking.ts'

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Extra template variables used by booking_confirmed / booking_nudge_client.
export function bookingVars(lead: any, cfg: BookingSettings) {
  const vars = leadVars(lead, cfg.team_timezone, lead.timezone || cfg.team_timezone) as Record<string, unknown>
  vars.duration_minutes = cfg.booking_duration_minutes
  vars.whatsapp_link = whatsappLink(cfg)
  vars.calendar_link = lead.scheduled_date ? googleCalendarLink(cfg, lead) : ''
  vars.meeting_details = cfg.meeting_link
    ? `<p style="margin: 8px 0 0; font-size: 14px;"><strong>Where:</strong> <a href="${escapeHtml(cfg.meeting_link)}" style="color: #C9260C; font-weight: 700;">Join on Google Meet</a></p>`
    : `<p style="margin: 8px 0 0; font-size: 14px;"><strong>Where:</strong> Online (Google Meet). We will email you the link before the call.</p>`
  return vars
}

async function loadTemplates(admin: any, keys: string[]) {
  const { data } = await admin.from('email_templates').select('*').in('template_key', keys)
  const map: Record<string, any> = {}
  ;(data || []).forEach((t: any) => { map[t.template_key] = t })
  return map
}

// A calendar file (RFC 5545) for the booked call, so it can be added to Apple, Outlook or Google Calendar.
export function buildIcs(lead: any, cfg: BookingSettings): string {
  const start = slotInstant(lead.scheduled_date, lead.scheduled_time, cfg.team_timezone)
  const end = start.plus({ minutes: cfg.booking_duration_minutes })
  const stamp = (d: any) => d.toUTC().toFormat("yyyyLLdd'T'HHmmss'Z'")
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
  const description = ['Free call with SDFM Group.', cfg.meeting_link ? `Join: ${cfg.meeting_link}` : 'We will email you the meeting link before the call.'].join('\n')
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SDFM Group//Booking//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${lead.id}@sdfmgroup.com`,
    `DTSTAMP:${stamp(DateTime.utc())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    'SUMMARY:Call with SDFM Group',
    `DESCRIPTION:${esc(description)}`,
    `LOCATION:${esc(cfg.meeting_link || 'Google Meet')}`,
    'STATUS:CONFIRMED',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n') + '\r\n'
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  bytes.forEach(b => { bin += String.fromCharCode(b) })
  return btoa(bin)
}

const REPLY_TO = Deno.env.get('BOOKING_REPLY_TO') || 'flex@sdfmgroup.com'

function shell(inner: string): string {
  return `<div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #201E1D;">
  <div style="padding: 28px 0 20px; text-align: center;">
    <span style="font-size: 22px; font-weight: 700; color: #EC3013;">SDFM GROUP</span>
    <span style="font-size: 12px; display: block; letter-spacing: 0.15em;">LIMITED</span>
  </div>
  <div style="background: #F3F2F2; border-radius: 10px; padding: 28px;">${inner}</div>
</div>`
}

function confirmationEmail(lead: any, cfg: BookingSettings) {
  const vars = bookingVars(lead, cfg)
  const first = String(lead.full_name || '').trim().split(/\s+/)[0] || 'there'
  const notes = lead.challenge_notes
    ? `<p style="font-size: 14px; color: #666; margin: 20px 0 0; line-height: 1.6;"><strong>What you told us:</strong><br>${escapeHtml(String(lead.challenge_notes)).replace(/\n/g, '<br>')}</p>`
    : ''
  const html = shell(`
    <h1 style="font-size: 20px; margin: 0 0 8px;">You're booked, ${escapeHtml(first)}</h1>
    <p style="font-size: 14px; color: #666; margin: 0 0 20px; line-height: 1.6;">Your ${vars.duration_minutes}-minute call with SDFM Group is confirmed.</p>
    <div style="background: white; border-radius: 8px; padding: 18px 20px; border-left: 4px solid #EC3013;">
      <p style="margin: 0; font-size: 14px;"><strong>Date:</strong> ${escapeHtml(String(vars.scheduled_day))}</p>
      <p style="margin: 8px 0 0; font-size: 14px;"><strong>Time:</strong> ${escapeHtml(String(vars.scheduled_time))} (${escapeHtml(String(vars.timezone))})</p>
      ${vars.meeting_details}
    </div>
    <p style="margin: 20px 0 0;"><a href="${escapeHtml(String(vars.calendar_link))}" style="display: inline-block; background: #EC3013; color: #fff; padding: 11px 20px; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 14px;">Add to Google Calendar</a></p>
    <p style="font-size: 13px; color: #666; margin: 12px 0 0; line-height: 1.6;">Using Apple Calendar or Outlook? Open the attached invite.ics file.</p>
    ${notes}
    <p style="font-size: 14px; color: #666; margin: 20px 0 0; line-height: 1.6;">Need to change the time? Just reply to this email.</p>`)
  return {
    subject: `You're booked: ${vars.scheduled_day} at ${vars.scheduled_time} (${vars.timezone})`,
    html,
  }
}

function teamEmailFor(lead: any, cfg: BookingSettings, zone: string, appUrl: string) {
  const vars = leadVars(lead, cfg.team_timezone, zone)
  const visitorZone = lead.timezone && lead.timezone !== zone ? `<p style="margin: 8px 0 0; font-size: 13px; color: #666;">Visitor's time zone: ${escapeHtml(String(lead.timezone))}</p>` : ''
  const html = shell(`
    <h1 style="font-size: 20px; margin: 0 0 16px;">New call booked</h1>
    <div style="background: white; border-radius: 8px; padding: 18px 20px;">
      <p style="margin: 0 0 8px; font-size: 14px;"><strong>When:</strong> ${escapeHtml(String(vars.scheduled_day))} at ${escapeHtml(String(vars.scheduled_time))} (${escapeHtml(String(vars.timezone))})</p>
      <p style="margin: 0 0 8px; font-size: 14px;"><strong>Name:</strong> ${escapeHtml(String(lead.full_name))}</p>
      <p style="margin: 0 0 8px; font-size: 14px;"><strong>Email:</strong> <a href="mailto:${escapeHtml(String(lead.email))}" style="color: #C9260C;">${escapeHtml(String(lead.email))}</a></p>
      <p style="margin: 0 0 8px; font-size: 14px;"><strong>Company:</strong> ${escapeHtml(String(lead.company_name))}</p>
      <p style="margin: 0; font-size: 14px;"><strong>Their problem:</strong><br>${escapeHtml(String(lead.challenge_notes || 'Not given')).replace(/\n/g, '<br>')}</p>
      ${visitorZone}
    </div>
    <p style="margin: 20px 0 0;"><a href="${escapeHtml(appUrl)}/pipeline" style="font-size: 14px; color: #C9260C; font-weight: 700;">Open the pipeline</a></p>`)
  return { subject: `New call booked: ${lead.full_name}, ${lead.company_name} (${vars.scheduled_day}, ${vars.scheduled_time})`, html }
}

// The visitor's confirmation (with a calendar file attached) and the team's notification for a freshly
// booked call. Both are built here rather than from the editable email templates, so they always say
// what the simplified booking form collects.
export async function sendBookingEmails(admin: any, lead: any, cfg: BookingSettings) {
  requireResendKey()
  const results: Record<string, unknown> = {}

  if (lead.email) {
    try {
      const mail = confirmationEmail(lead, cfg)
      await sendViaResend([lead.email], mail.subject, mail.html, {
        replyTo: REPLY_TO,
        attachments: [{ filename: 'invite.ics', content: toBase64(buildIcs(lead, cfg)) }],
      })
      results.client = { success: true }
    } catch (err) {
      results.client = { success: false, error: (err as Error).message }
    }
  }

  try {
    const staff = (await staffWithModule(admin, 'pipeline', ['admin', 'sales'], 'email, timezone')).filter((p: any) => p.email)
    const { data: setting } = await admin.from('system_settings').select('value').eq('key', 'app_base_url').maybeSingle()
    const appUrl = String(setting?.value || 'https://spm.sdfmgroup.com').replace(/\/+$/, '')
    if (staff.length > 0) {
      const sends = await Promise.allSettled(staff.map((p: any) => {
        const mail = teamEmailFor(lead, cfg, p.timezone || cfg.team_timezone, appUrl)
        return sendViaResend([p.email], mail.subject, mail.html, { replyTo: lead.email })
      }))
      const failed = sends.filter(s => s.status === 'rejected').length
      results.team = { success: failed === 0, recipients: staff.length, failed }
    } else {
      results.team = { success: false, error: 'No staff with the pipeline module have an email address' }
    }
  } catch (err) {
    results.team = { success: false, error: (err as Error).message }
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
