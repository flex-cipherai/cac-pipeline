// Supabase Edge Function: google-calendar
// Handles Google Calendar OAuth and event creation
//
// Deploy: supabase functions deploy google-calendar
// Set secrets:
//   supabase secrets set GOOGLE_CLIENT_ID=your_client_id
//   supabase secrets set GOOGLE_CLIENT_SECRET=your_client_secret
//   supabase secrets set GOOGLE_REDIRECT_URI=https://your-site.netlify.app/settings

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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    const { action, ...params } = await req.json()

    switch (action) {
      // ── Step 1: Get the Google OAuth URL ──
      case 'get-auth-url': {
        const scopes = [
          'https://www.googleapis.com/auth/calendar.events',
          'https://www.googleapis.com/auth/calendar.readonly',
        ]
        const url = `https://accounts.google.com/o/oauth2/v2/auth?` +
          `client_id=${GOOGLE_CLIENT_ID}` +
          `&redirect_uri=${encodeURIComponent(GOOGLE_REDIRECT_URI!)}` +
          `&response_type=code` +
          `&scope=${encodeURIComponent(scopes.join(' '))}` +
          `&access_type=offline` +
          `&prompt=consent`

        return jsonResponse({ url })
      }

      // ── Step 2: Exchange auth code for tokens ──
      case 'exchange-code': {
        const { code } = params
        if (!code) throw new Error('Missing authorization code')

        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: GOOGLE_CLIENT_ID!,
            client_secret: GOOGLE_CLIENT_SECRET!,
            redirect_uri: GOOGLE_REDIRECT_URI!,
            grant_type: 'authorization_code',
          }),
        })

        const tokens = await tokenRes.json()
        if (tokens.error) throw new Error(tokens.error_description || tokens.error)

        // Store tokens in Supabase (encrypted via RLS)
        const supabase = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        )

        await supabase
          .from('system_settings')
          .upsert({
            key: 'google_calendar_tokens',
            value: JSON.stringify({
              access_token: tokens.access_token,
              refresh_token: tokens.refresh_token,
              expiry: Date.now() + (tokens.expires_in * 1000),
            }),
          }, { onConflict: 'key' })

        // Get the user's calendar email
        const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        })
        const profile = await profileRes.json()

        await supabase
          .from('system_settings')
          .upsert({
            key: 'google_calendar_email',
            value: profile.email || '',
          }, { onConflict: 'key' })

        return jsonResponse({ success: true, email: profile.email })
      }

      // ── Step 3: Create a calendar event ──
      case 'create-event': {
        const { summary, description, date, time, duration_minutes = 30 } = params

        const accessToken = await getValidAccessToken()
        if (!accessToken) throw new Error('Google Calendar not connected')

        // Build event datetime
        const startDateTime = `${date}T${time}:00`
        const startDate = new Date(startDateTime)
        const endDate = new Date(startDate.getTime() + duration_minutes * 60000)

        const event = {
          summary: summary || 'Discovery Call — Cipher AI Consultants',
          description: description || '',
          start: {
            dateTime: startDate.toISOString(),
            timeZone: 'Africa/Nairobi',
          },
          end: {
            dateTime: endDate.toISOString(),
            timeZone: 'Africa/Nairobi',
          },
          reminders: {
            useDefault: false,
            overrides: [
              { method: 'email', minutes: 60 },
              { method: 'popup', minutes: 15 },
            ],
          },
        }

        const calRes = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(event),
        })

        const calData = await calRes.json()
        if (calData.error) throw new Error(calData.error.message)

        return jsonResponse({ success: true, eventId: calData.id, htmlLink: calData.htmlLink })
      }

      // ── Disconnect ──
      case 'disconnect': {
        const supabase = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        )

        await supabase.from('system_settings').delete().eq('key', 'google_calendar_tokens')
        await supabase.from('system_settings').delete().eq('key', 'google_calendar_email')

        return jsonResponse({ success: true })
      }

      // ── Check connection status ──
      case 'status': {
        const supabase = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        )

        const { data } = await supabase
          .from('system_settings')
          .select('value')
          .eq('key', 'google_calendar_email')
          .single()

        return jsonResponse({
          connected: !!data?.value,
          email: data?.value || null,
        })
      }

      default:
        throw new Error(`Unknown action: ${action}`)
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
})

// ── Helper: refresh access token if expired ──
async function getValidAccessToken(): Promise<string | null> {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', 'google_calendar_tokens')
    .single()

  if (!data?.value) return null

  const tokens = JSON.parse(data.value)

  // If token is still valid, return it
  if (tokens.expiry > Date.now() + 60000) {
    return tokens.access_token
  }

  // Refresh the token
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID!,
      client_secret: GOOGLE_CLIENT_SECRET!,
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token',
    }),
  })

  const newTokens = await res.json()
  if (newTokens.error) return null

  // Update stored tokens
  await supabase
    .from('system_settings')
    .upsert({
      key: 'google_calendar_tokens',
      value: JSON.stringify({
        access_token: newTokens.access_token,
        refresh_token: tokens.refresh_token, // Keep the original refresh token
        expiry: Date.now() + (newTokens.expires_in * 1000),
      }),
    }, { onConflict: 'key' })

  return newTokens.access_token
}

function jsonResponse(data: any) {
  return new Response(JSON.stringify(data), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}
