// Supabase Edge Function: booking-confirm
// Public (needs the lead id + token from booking-start). Step 2: books the
// chosen slot. Re-checks the slot against a fresh calendar, relies on the
// unique (slot_date, time_slot) constraint to make double-booking impossible,
// moves the lead to "Scheduled" and sends the confirmation + team alert.
//
// Everyone who picks a time is confirmed — qualification happens afterwards
// (booking-prep) and only scores the lead for the team's prioritisation.
//
// Deploy: supabase functions deploy booking-confirm

import { DateTime } from 'https://esm.sh/luxon@3.5.0'
import {
  adminClient, allowRequest, getLeadByToken, googleCalendarLink, ipHash, isDateStr, isTimeStr,
  isValidZone, json, loadSettings, openSlots, preflight, prepLink, slotInstant, whatsappLink,
} from '../_shared/booking.ts'
import { sendBookingEmails } from '../_shared/bookingEmail.ts'

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req)
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405)

  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return json(req, { error: 'invalid_request' }, 400)
    if (!isDateStr(body.date) || !isTimeStr(body.time)) return json(req, { error: 'invalid_slot' }, 400)

    const admin = adminClient()
    if (!(await allowRequest(admin, await ipHash(req), 'confirm', 15, 60))) {
      return json(req, { error: 'rate_limited' }, 429)
    }

    const lead = await getLeadByToken(admin, body.lead_id, body.token)
    if (!lead) return json(req, { error: 'invalid_lead' }, 403)

    const cfg = await loadSettings(admin)

    const response = (l: any) => {
      const start = slotInstant(l.scheduled_date, l.scheduled_time, cfg.team_timezone)
      const zone = isValidZone(l.timezone) ? l.timezone : cfg.team_timezone
      const local = start.setZone(zone)
      return {
        ok: true,
        scheduled_date: l.scheduled_date,
        scheduled_time: l.scheduled_time,
        local_day: local.toFormat('cccc, d LLLL yyyy'),
        local_time: local.toFormat('h:mm a'),
        local_zone: local.toFormat('ZZZZ'),
        starts_at: start.toUTC().toISO(),
        duration_minutes: cfg.booking_duration_minutes,
        meeting_link: cfg.meeting_link || null,
        calendar_link: googleCalendarLink(cfg, l),
        prep_link: prepLink(l),
        whatsapp_link: whatsappLink(cfg),
      }
    }

    // Already booked: same slot = idempotent retry, anything else = refuse.
    if (lead.current_stage !== 'Incomplete' && lead.scheduled_date) {
      if (lead.scheduled_date === body.date && lead.scheduled_time === body.time) return json(req, response(lead))
      return json(req, { error: 'already_booked' }, 409)
    }

    // Is the slot still open right now?
    const open = await openSlots(admin, cfg)
    if (!(open[body.date] || []).includes(body.time)) {
      return json(req, { error: 'slot_unavailable' }, 409)
    }

    const day = DateTime.fromISO(body.date, { zone: cfg.team_timezone })
    const { error: slotError } = await admin.from('booked_slots').insert({
      lead_id: lead.id,
      slot_date: body.date,
      time_slot: body.time,
      day_of_week: day.weekday,
    })
    if (slotError) {
      // 23505 = unique violation: someone else took it between the check and now.
      if ((slotError as any).code === '23505') return json(req, { error: 'slot_unavailable' }, 409)
      console.error('[booking-confirm] booked_slots insert failed', slotError)
      return json(req, { error: 'server_error' }, 500)
    }

    const timezone = isValidZone(body.timezone) ? body.timezone : (lead.timezone || cfg.team_timezone)
    const update = {
      current_stage: 'Scheduled',
      scheduled_date: body.date,
      scheduled_time: body.time,
      scheduled_day: day.toFormat('ccc, d LLL'),
      timezone,
      booked_at: new Date().toISOString(),
    }
    const { data: updated, error: updateError } = await admin
      .from('leads').update(update).eq('id', lead.id).select('*').single()

    if (updateError || !updated) {
      // Give the slot back rather than leave an orphaned booking.
      await admin.from('booked_slots').delete().eq('lead_id', lead.id).eq('slot_date', body.date).eq('time_slot', body.time)
      console.error('[booking-confirm] lead update failed', updateError)
      return json(req, { error: 'server_error' }, 500)
    }

    await admin.from('lead_stage_history').insert({ lead_id: lead.id, stage: 'Scheduled' })

    // Emails must never delay or break the confirmation screen.
    const mail = sendBookingEmails(admin, updated, cfg).catch(err => console.error('[booking-confirm] email failed', err))
    if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(mail)
    else await mail

    return json(req, response(updated))
  } catch (err) {
    console.error('[booking-confirm]', err)
    return json(req, { error: 'server_error' }, 500)
  }
})
