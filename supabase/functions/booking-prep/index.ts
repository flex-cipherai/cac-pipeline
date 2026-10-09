// Supabase Edge Function: booking-prep
// Public (needs the lead id + token). The optional "help us prepare" questions
// shown after a call is booked. Answers are scored here and only change the
// lead's hot / warm / cold tier — nobody is ever turned away because of them.
//
// Deploy: supabase functions deploy booking-prep

import {
  adminClient, allowRequest, answersFromLead, getLeadByToken, ipHash, json, preflight, QUESTIONS,
  scoreAnswers,
} from '../_shared/booking.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req)
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405)

  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object' || typeof body.answers !== 'object' || body.answers === null) {
      return json(req, { error: 'invalid_request' }, 400)
    }

    const admin = adminClient()
    if (!(await allowRequest(admin, await ipHash(req), 'prep', 20, 60))) {
      return json(req, { error: 'rate_limited' }, 429)
    }

    const lead = await getLeadByToken(admin, body.lead_id, body.token)
    if (!lead) return json(req, { error: 'invalid_lead' }, 403)

    // Keep only known question keys with known option values; merge over earlier answers.
    const incoming: Record<string, string> = {}
    for (const [key, q] of Object.entries(QUESTIONS)) {
      const v = (body.answers as Record<string, unknown>)[key]
      if (typeof v === 'string' && q.options.some(o => o.value === v)) incoming[key] = v
    }
    if (Object.keys(incoming).length === 0) return json(req, { error: 'no_answers' }, 400)

    const merged = { ...answersFromLead(lead), ...incoming }
    const scored = scoreAnswers(merged)

    const update: Record<string, unknown> = {
      ...scored.fields,
      total_score: scored.total_score,
      classification: scored.classification,
      is_disqualified: false, // the booking flow never rejects anyone
      disqualifier_reason: scored.disqualifier_reason,
      qualification_completed_at: scored.complete ? new Date().toISOString() : lead.qualification_completed_at,
    }

    const { error } = await admin.from('leads').update(update).eq('id', lead.id)
    if (error) {
      console.error('[booking-prep] update failed', error)
      return json(req, { error: 'server_error' }, 500)
    }

    // Deliberately does not return the tier: it is for the team, not the visitor.
    return json(req, { ok: true, complete: scored.complete })
  } catch (err) {
    console.error('[booking-prep]', err)
    return json(req, { error: 'server_error' }, 500)
  }
})
