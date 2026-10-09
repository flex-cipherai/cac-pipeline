// Supabase Edge Function: booking-info
// Public. Everything the booking page needs to render: the open time slots
// (computed server-side, in the team's timezone), the call length, and — only
// when the visitor presents a valid lead id + token — the state of their own
// booking so they can resume it from an email link.
//
// Deploy: supabase functions deploy booking-info

import {
  adminClient, allowRequest, getLeadByToken, ipHash, json, loadSettings, openSlots, preflight,
  googleCalendarLink, whatsappLink,
} from '../_shared/booking.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req)
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405)

  try {
    const admin = adminClient()
    if (!(await allowRequest(admin, await ipHash(req), 'info', 120, 10))) {
      return json(req, { error: 'rate_limited' }, 429)
    }

    const body = await req.json().catch(() => ({}))
    const cfg = await loadSettings(admin)
    const slots = await openSlots(admin, cfg)

    const response: Record<string, unknown> = {
      config: {
        duration_minutes: cfg.booking_duration_minutes,
        team_timezone: cfg.team_timezone,
        window_days: cfg.booking_window_days,
        whatsapp_link: whatsappLink(cfg),
      },
      slots,
    }

    const lead = await getLeadByToken(admin, body.lead_id, body.token)
    if (lead) {
      const booked = lead.current_stage !== 'Incomplete' && !!lead.scheduled_date
      response.lead = {
        first_name: String(lead.full_name || '').split(' ')[0],
        company_name: lead.company_name,
        booked,
        prep_done: !!lead.qualification_completed_at,
        timezone: lead.timezone || cfg.team_timezone,
        ...(booked ? {
          scheduled_date: lead.scheduled_date,
          scheduled_time: lead.scheduled_time,
          meeting_link: cfg.meeting_link || null,
          calendar_link: googleCalendarLink(cfg, lead),
        } : {}),
      }
    }

    return json(req, response)
  } catch (err) {
    console.error('[booking-info]', err)
    return json(req, { error: 'server_error' }, 500)
  }
})
