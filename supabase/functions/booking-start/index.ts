// Supabase Edge Function: booking-start
// Public. Step 1 of the booking page: saves the visitor's contact details as a
// lead the moment they continue (stage "Incomplete"), so a visitor who never
// picks a time can still be followed up. Returns the lead id + secret token the
// browser uses for the remaining steps.
//
// Deploy: supabase functions deploy booking-start

import {
  adminClient, allowRequest, cleanSource, ipHash, isValidZone, json, likeEscape, loadSettings, preflight,
  validateContact,
} from '../_shared/booking.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req)
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405)

  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return json(req, { error: 'invalid_request' }, 400)

    // Honeypot: real visitors never see this field. Pretend it worked.
    if (typeof body.website === 'string' && body.website.trim() !== '') {
      return json(req, { lead_id: crypto.randomUUID(), token: crypto.randomUUID() })
    }

    const { errors, value } = validateContact(body)
    if (Object.keys(errors).length) return json(req, { error: 'validation', fields: errors }, 400)

    const admin = adminClient()
    if (!(await allowRequest(admin, await ipHash(req), 'start', 8, 60))) {
      return json(req, { error: 'rate_limited' }, 429)
    }

    const cfg = await loadSettings(admin)
    const timezone = isValidZone(body.timezone) ? body.timezone : cfg.team_timezone
    const source = cleanSource(body.source)

    // Same email again?
    const { data: existing } = await admin
      .from('leads')
      .select('id, booking_token, current_stage, scheduled_date, created_at')
      .ilike('email', likeEscape(value.email))
      .order('created_at', { ascending: false })
      .limit(5)

    const today = new Date().toISOString().slice(0, 10)
    const upcoming = (existing || []).find((l: any) => l.current_stage === 'Scheduled' && l.scheduled_date && l.scheduled_date >= today)
    if (upcoming) {
      return json(req, { error: 'already_booked' }, 409)
    }

    // An unfinished booking from the last 7 days is reused instead of duplicated.
    const weekAgo = Date.now() - 7 * 86400000
    const reusable = (existing || []).find((l: any) => l.current_stage === 'Incomplete' && new Date(l.created_at).getTime() > weekAgo)
    if (reusable) {
      await admin.from('leads').update({ ...value, timezone }).eq('id', reusable.id)
      return json(req, { lead_id: reusable.id, token: reusable.booking_token })
    }

    const leadId = crypto.randomUUID()
    const { data: created, error } = await admin
      .from('leads')
      .insert({
        id: leadId,
        ...value,
        classification: 'unscored',
        current_stage: 'Incomplete',
        source,
        timezone,
      })
      .select('booking_token')
      .single()

    if (error || !created) {
      console.error('[booking-start] insert failed', error)
      return json(req, { error: 'server_error' }, 500)
    }

    return json(req, { lead_id: leadId, token: created.booking_token })
  } catch (err) {
    console.error('[booking-start]', err)
    return json(req, { error: 'server_error' }, 500)
  }
})
