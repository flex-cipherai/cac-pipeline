// Supabase Edge Function: website-lead
// Public. Receives the five lead forms on sdfmgroup.com (assessment, guide, industry, custom, contact),
// saves each as an inquiry (channel "website") in the CRM, emails the visitor a confirmation and
// alerts the team. Everything is validated again here: the browser is never trusted.
//
// An inquiry is the CRM's "someone reached out" record (see migration-inquiries.sql); staff work it in
// Inquiries and convert it to a lead. migration-website-leads.sql adds columns for offer, staff band,
// sector and attribution. Until that migration is run the same data is still saved, inside the message.
//
// Deploy: supabase functions deploy website-lead
// Needs: migration-inquiries.sql, migration-booking-flow.sql (booking_attempts rate limit table), and for
// email the same secrets as the other functions (RESEND_API_KEY, SENDER_EMAIL).

import { adminClient, allowRequest, ipHash, json, preflight, SITE_URL } from '../_shared/booking.ts'
import { requireResendKey, sendViaResend } from '../_shared/resend.ts'
import { staffWithModule } from '../_shared/access.ts'
import {
  buildMessage, detectSource, followUpDate, sourceDetail, teamEmail, validateLead, visitorEmail,
} from '../_shared/websiteLead.ts'

// Real people need a moment to fill a form; the page itself waits this long before sending.
const MIN_FILL_MS = 2500

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req)
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405)

  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return json(req, { error: 'invalid_request' }, 400)

    // Honeypot filled, or sent faster than a person can type: pretend it worked and save nothing.
    const tooFast = typeof body.elapsed_ms === 'number' && body.elapsed_ms < MIN_FILL_MS
    if ((typeof body.website === 'string' && body.website.trim() !== '') || tooFast) {
      return json(req, { ok: true })
    }

    const { errors, value } = validateLead(body)
    if (!value || Object.keys(errors).length) return json(req, { error: 'validation', fields: errors }, 400)

    const admin = adminClient()
    if (!(await allowRequest(admin, await ipHash(req), 'lead', 6, 60))) {
      return json(req, { error: 'rate_limited' }, 429)
    }

    const source = detectSource(value)
    const base = {
      full_name: value.full_name,
      company_name: value.business_name,
      email: value.email,
      phone: value.phone,
      has_whatsapp: false,
      channel: 'website',
      source_detail: sourceDetail(value),
      message: buildMessage(value),
      status: 'new',
      next_follow_up: followUpDate(value.offer, new Date()),
    }
    const extra = {
      offer: value.offer, staff_band: value.staff_band, sector: value.sector, interest: value.interest,
      past_work: value.past_work, page_url: value.page_url, referrer: value.referrer,
      utm_source: value.utm_source, utm_medium: value.utm_medium, utm_campaign: value.utm_campaign, utm_term: value.utm_term,
    }

    let { error } = await admin.from('inquiries').insert({ ...base, ...extra })
    // migration-website-leads.sql not run yet: save without the extra columns rather than lose the enquiry.
    if (error && /column|schema cache/i.test(error.message || '')) {
      console.warn('[website-lead] extra columns missing, saving the base inquiry', error.message)
      ;({ error } = await admin.from('inquiries').insert(base))
    }
    if (error) {
      console.error('[website-lead] insert failed', error)
      return json(req, { error: 'server_error' }, 500)
    }

    // Emails are best effort: the enquiry is already saved, so a failure here must not fail the request.
    try {
      requireResendKey()
      const visitor = visitorEmail(value, SITE_URL)
      const alert = teamEmail(value, source)
      const staff = (await staffWithModule(admin, 'inquiries', ['admin', 'sales'], 'email')).filter((p: any) => p.email)
      await Promise.race([
        Promise.allSettled([
          sendViaResend([value.email], visitor.subject, visitor.html),
          ...(staff.length ? [sendViaResend(staff.map((p: any) => p.email), alert.subject, alert.html)] : []),
        ]),
        new Promise(resolve => setTimeout(resolve, 8000)),
      ])
    } catch (err) {
      console.error('[website-lead] email failed', (err as Error).message)
    }

    return json(req, { ok: true })
  } catch (err) {
    console.error('[website-lead]', err)
    return json(req, { error: 'server_error' }, 500)
  }
})
