// Supabase Edge Function: send-booking-nudges
// Run every 15 minutes by pg_cron (see migration-booking-nudges-cron.sql).
// Emails people who entered their details on sdfmgroup.com/book but never
// picked a time: once, 30 minutes to 48 hours after they started. The email
// carries a link that reopens the booking page at the time-picking step.
//
// Deploy: supabase functions deploy send-booking-nudges

import { adminClient, corsHeaders, likeEscape, loadSettings } from '../_shared/booking.ts'
import { sendNudgeEmail } from '../_shared/bookingEmail.ts'

const NUDGE_AFTER_MINUTES = 30
const GIVE_UP_AFTER_HOURS = 48

Deno.serve(async (req) => {
  const headers = { ...corsHeaders(req), 'Content-Type': 'application/json' }
  if (req.method === 'OPTIONS') return new Response('ok', { headers })

  try {
    const admin = adminClient()

    const { data: tmpl } = await admin.from('email_templates').select('*').eq('template_key', 'booking_nudge_client').maybeSingle()
    // Template off or missing: leave nudge_sent_at alone so leads are still nudged once it is switched on.
    if (!tmpl?.is_active) {
      return new Response(JSON.stringify({ success: true, nudged: 0, note: 'booking_nudge_client is inactive' }), { headers })
    }

    const cfg = await loadSettings(admin)
    const olderThan = new Date(Date.now() - NUDGE_AFTER_MINUTES * 60_000).toISOString()
    const newerThan = new Date(Date.now() - GIVE_UP_AFTER_HOURS * 3_600_000).toISOString()

    const { data: candidates, error } = await admin
      .from('leads')
      .select('*')
      .eq('current_stage', 'Incomplete')
      .is('nudge_sent_at', null)
      .lt('created_at', olderThan)
      .gt('created_at', newerThan)
      .limit(50)

    if (error) return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers })

    let nudged = 0
    for (const lead of candidates || []) {
      // Skip anyone who has since booked under the same email (e.g. from another device).
      const { count } = await admin
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .ilike('email', likeEscape(lead.email))
        .eq('current_stage', 'Scheduled')
      if ((count ?? 0) > 0) {
        await admin.from('leads').update({ nudge_sent_at: new Date().toISOString() }).eq('id', lead.id)
        continue
      }

      try {
        if (await sendNudgeEmail(admin, lead, cfg, tmpl)) {
          await admin.from('leads').update({ nudge_sent_at: new Date().toISOString() }).eq('id', lead.id)
          nudged++
        }
      } catch (err) {
        console.error('[send-booking-nudges] failed for lead', lead.id, err)
      }
    }

    return new Response(JSON.stringify({ success: true, nudged }), { headers })
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: (err as Error).message }), { status: 500, headers })
  }
})
