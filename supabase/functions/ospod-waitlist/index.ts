// Supabase Edge Function: ospod-waitlist
// Public. The Ospod landing pages (podcasters and studios) call this:
//   GET   -> { claimed }   how many founding spots are taken (the page's meter)
//   POST  -> save a signup, email the team, answer { ok, member_no, founding, claimed }
// Everything is validated again here: the browser is never trusted. Signups are saved by the database
// function ospod_waitlist_join(), which numbers people under a lock (see migration-ospod-waitlist.sql).
//
// Deploy: supabase functions deploy ospod-waitlist --no-verify-jwt
// Needs: migration-ospod-waitlist.sql, migration-booking-flow.sql (booking_attempts, the rate limit table),
//        and for the team email RESEND_API_KEY and SENDER_EMAIL (the same secrets as the other functions).
// Optional secret: OSPOD_ALLOWED_ORIGINS, comma separated, for the landing page addresses (see ALLOWED below).

import { adminClient, allowRequest, ipHash } from '../_shared/booking.ts'
import { requireResendKey, sendViaResend } from '../_shared/resend.ts'
import { staffWithModule } from '../_shared/access.ts'
import { FOUNDING_CAP, looksLikeBot, signupAlert, validateSignup } from '../_shared/ospodWaitlist.ts'

// Which sites may call this from a browser. Add the final address with:
//   supabase secrets set OSPOD_ALLOWED_ORIGINS=https://ospod.sdfmgroup.com
// *.netlify.app is allowed too so the first Netlify deploy works before the custom domain is attached;
// once the custom domain is live you can drop it by setting OSPOD_ALLOW_NETLIFY=false.
const EXTRA = (Deno.env.get('OSPOD_ALLOWED_ORIGINS') || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean)
const ALLOWED = ['https://ospod.sdfmgroup.com', 'http://localhost:4173', 'http://localhost:5173', ...EXTRA]
const ALLOW_NETLIFY = (Deno.env.get('OSPOD_ALLOW_NETLIFY') || 'true').toLowerCase() !== 'false'

function originAllowed(origin: string) {
  if (ALLOWED.includes(origin)) return true
  return ALLOW_NETLIFY && /^https:\/\/[a-z0-9-]+\.netlify\.app$/.test(origin)
}

function cors(req: Request) {
  const origin = req.headers.get('origin') || ''
  return {
    'Access-Control-Allow-Origin': originAllowed(origin) ? origin : ALLOWED[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin',
  }
}

function reply(req: Request, body: Record<string, unknown>, status = 200, cache = 'no-store') {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), 'Content-Type': 'application/json', 'Cache-Control': cache },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })

  try {
    const admin = adminClient()

    if (req.method === 'GET') {
      const { data, error } = await admin.rpc('ospod_waitlist_claimed', { p_cap: FOUNDING_CAP })
      if (error) {
        console.error('[ospod-waitlist] count failed', error)
        return reply(req, { error: 'server_error' }, 500)
      }
      // A few seconds of caching keeps a burst of ad traffic from hitting the database on every page view.
      return reply(req, { claimed: data ?? 0 }, 200, 'public, max-age=10')
    }

    if (req.method !== 'POST') return reply(req, { error: 'method_not_allowed' }, 405)

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return reply(req, { error: 'invalid_request' }, 400)

    // Honeypot filled, or sent faster than a person can answer: pretend it worked and save nothing.
    if (looksLikeBot(body)) return reply(req, { ok: true, member_no: null, founding: true, claimed: null })

    const { errors, value } = validateSignup(body)
    if (!value || Object.keys(errors).length) return reply(req, { error: 'validation', fields: errors }, 400)

    const hash = await ipHash(req)
    if (!(await allowRequest(admin, hash, 'ospod', 8, 60))) return reply(req, { error: 'rate_limited' }, 429)

    const { data: joined, error } = await admin.rpc('ospod_waitlist_join', {
      p: { ...value, ip_hash: hash },
      p_cap: FOUNDING_CAP,
    })
    if (error || !joined) {
      console.error('[ospod-waitlist] join failed', error)
      return reply(req, { error: 'server_error' }, 500)
    }

    // The team alert is best effort: the signup is already saved, so a failure here must not fail the request.
    // Someone who submits twice (already on the list) does not trigger a second alert.
    if (!joined.already) {
      try {
        requireResendKey()
        const recipients = (await staffWithModule(admin, 'ospod_waitlist', ['admin'], 'id, email'))
          .map((p: { email?: string }) => p.email).filter(Boolean) as string[]
        if (recipients.length) {
          const { data: setting } = await admin.from('system_settings').select('value').eq('key', 'app_base_url').maybeSingle()
          const mail = signupAlert({
            value, memberNo: joined.member_no, founding: joined.founding, claimed: joined.claimed,
            appUrl: setting?.value || undefined,
          })
          await sendViaResend(recipients, mail.subject, mail.html, { replyTo: value.email })
          await admin.from('ospod_waitlist_signups').update({ notified_at: new Date().toISOString() }).eq('id', joined.id)
        } else {
          console.warn('[ospod-waitlist] nobody has the ospod_waitlist module, no alert sent')
        }
      } catch (e) {
        console.error('[ospod-waitlist] alert email failed', e)
      }
    }

    return reply(req, {
      ok: true, member_no: joined.member_no, founding: joined.founding, claimed: joined.claimed,
    })
  } catch (e) {
    console.error('[ospod-waitlist] unexpected', e)
    return reply(req, { error: 'server_error' }, 500)
  }
})
