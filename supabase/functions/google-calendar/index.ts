import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')
const GOOGLE_REDIRECT_URI = Deno.env.get('GOOGLE_REDIRECT_URI')

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabaseAdmin = () => createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })

  try {
    const { action, ...params } = await req.json()

    switch (action) {
      case 'get-auth-url': {
        const scopes = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly']
        const state = params.user_id || ''
        const url = `https://accounts.google.com/o/oauth2/v2/auth?` +
          `client_id=${GOOGLE_CLIENT_ID}` +
          `&redirect_uri=${encodeURIComponent(GOOGLE_REDIRECT_URI!)}` +
          `&response_type=code&scope=${encodeURIComponent(scopes.join(' '))}` +
          `&access_type=offline&prompt=consent&state=${state}`
        return jsonResponse({ url })
      }

      case 'exchange-code': {
        const { code, user_id } = params
        if (!code) throw new Error('Missing authorization code')

        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code, client_id: GOOGLE_CLIENT_ID!, client_secret: GOOGLE_CLIENT_SECRET!,
            redirect_uri: GOOGLE_REDIRECT_URI!, grant_type: 'authorization_code',
          }),
        })
        const tokens = await tokenRes.json()
        if (tokens.error) throw new Error(tokens.error_description || tokens.error)

        const sb = supabaseAdmin()
        const tokenKey = user_id ? `gcal_tokens_${user_id}` : 'google_calendar_tokens'
        const emailKey = user_id ? `gcal_email_${user_id}` : 'google_calendar_email'

        await sb.from('system_settings').upsert({
          key: tokenKey,
          value: JSON.stringify({ access_token: tokens.access_token, refresh_token: tokens.refresh_token, expiry: Date.now() + (tokens.expires_in * 1000) }),
        }, { onConflict: 'key' })

        const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        })
        const profile = await profileRes.json()

        await sb.from('system_settings').upsert({ key: emailKey, value: profile.email || '' }, { onConflict: 'key' })

        return jsonResponse({ success: true, email: profile.email })
      }

      case 'create-event': {
        const { summary, description, date, time, duration_minutes = 30, user_id } = params
        const accessToken = await getValidAccessToken(user_id)
        if (!accessToken) throw new Error('Google Calendar not connected')

        const startDate = new Date(`${date}T${time}:00`)
        const endDate = new Date(startDate.getTime() + duration_minutes * 60000)

        const event = {
          summary: summary || 'Discovery Call — Cipher AI Consultants',
          description: description || '',
          start: { dateTime: startDate.toISOString(), timeZone: 'Africa/Nairobi' },
          end: { dateTime: endDate.toISOString(), timeZone: 'Africa/Nairobi' },
          reminders: { useDefault: false, overrides: [{ method: 'email', minutes: 60 }, { method: 'popup', minutes: 15 }] },
        }

        const calRes = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(event),
        })
        const calData = await calRes.json()
        if (calData.error) throw new Error(calData.error.message)

        return jsonResponse({ success: true, eventId: calData.id, htmlLink: calData.htmlLink })
      }

      case 'disconnect': {
        const { user_id } = params
        const sb = supabaseAdmin()
        const tokenKey = user_id ? `gcal_tokens_${user_id}` : 'google_calendar_tokens'
        const emailKey = user_id ? `gcal_email_${user_id}` : 'google_calendar_email'
        await sb.from('system_settings').delete().eq('key', tokenKey)
        await sb.from('system_settings').delete().eq('key', emailKey)
        return jsonResponse({ success: true })
      }

      case 'status': {
        const { user_id } = params
        const sb = supabaseAdmin()
        const emailKey = user_id ? `gcal_email_${user_id}` : 'google_calendar_email'
        const { data } = await sb.from('system_settings').select('value').eq('key', emailKey).single()
        return jsonResponse({ connected: !!data?.value, email: data?.value || null })
      }

      default: throw new Error(`Unknown action: ${action}`)
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
})

async function getValidAccessToken(userId?: string): Promise<string | null> {
  const sb = supabaseAdmin()
  const tokenKey = userId ? `gcal_tokens_${userId}` : 'google_calendar_tokens'
  const { data } = await sb.from('system_settings').select('value').eq('key', tokenKey).single()
  if (!data?.value) return null

  const tokens = JSON.parse(data.value)
  if (tokens.expiry > Date.now() + 60000) return tokens.access_token

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID!, client_secret: GOOGLE_CLIENT_SECRET!,
      refresh_token: tokens.refresh_token, grant_type: 'refresh_token',
    }),
  })
  const nt = await res.json()
  if (nt.error) return null

  await sb.from('system_settings').upsert({
    key: tokenKey,
    value: JSON.stringify({ access_token: nt.access_token, refresh_token: tokens.refresh_token, expiry: Date.now() + (nt.expires_in * 1000) }),
  }, { onConflict: 'key' })

  return nt.access_token
}

function jsonResponse(data: any) {
  return new Response(JSON.stringify(data), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
}
