// Shared helpers for the public booking Edge Functions
// (booking-info, booking-start, booking-confirm, booking-prep, send-booking-nudges).
//
// The booking page on sdfmgroup.com never touches the database directly: it
// calls these functions, which run with the service role and do all the
// validation, slot checking and scoring server-side.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { DateTime } from 'https://esm.sh/luxon@3.5.0'
import { DEFAULT_TIMEZONE } from './datetime.ts'

// ── Config ───────────────────────────────────────────────────────────────

export const SITE_URL = (Deno.env.get('SITE_URL') || 'https://sdfmgroup.com').replace(/\/+$/, '')

const ALLOWED_ORIGINS = [
  SITE_URL,
  'https://www.sdfmgroup.com',
  'http://localhost:8888',
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
]

export function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') || ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : SITE_URL,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

export function json(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

export function preflight(req: Request) {
  return new Response('ok', { headers: corsHeaders(req) })
}

export function adminClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

// ── Settings ─────────────────────────────────────────────────────────────

export interface BookingSettings {
  booking_window_days: number
  booking_min_notice_hours: number
  booking_duration_minutes: number
  booking_buffer_minutes: number
  team_timezone: string
  meeting_link: string
  whatsapp_number: string
}

const SETTING_KEYS = [
  'booking_window_days', 'booking_min_notice_hours', 'booking_duration_minutes',
  'booking_buffer_minutes', 'team_timezone', 'meeting_link', 'whatsapp_number',
]

export async function loadSettings(admin: any): Promise<BookingSettings> {
  const { data } = await admin.from('system_settings').select('key, value').in('key', SETTING_KEYS)
  const raw: Record<string, string> = {}
  ;(data || []).forEach((r: any) => { raw[r.key] = r.value })
  const int = (k: string, d: number) => {
    const n = parseInt(raw[k], 10)
    return Number.isFinite(n) ? n : d
  }
  return {
    booking_window_days: int('booking_window_days', 14),
    booking_min_notice_hours: int('booking_min_notice_hours', 4),
    booking_duration_minutes: int('booking_duration_minutes', 30),
    booking_buffer_minutes: int('booking_buffer_minutes', 0),
    team_timezone: isValidZone(raw.team_timezone) ? raw.team_timezone : DEFAULT_TIMEZONE,
    meeting_link: (raw.meeting_link || '').trim(),
    whatsapp_number: (raw.whatsapp_number || '254757230579').replace(/\D/g, ''),
  }
}

// ── Time slots ───────────────────────────────────────────────────────────

export function isValidZone(zone: unknown): zone is string {
  return typeof zone === 'string' && zone.length > 0 && zone.length < 60 && DateTime.local().setZone(zone).isValid
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export function isDateStr(v: unknown): v is string { return typeof v === 'string' && DATE_RE.test(v) }
export function isTimeStr(v: unknown): v is string { return typeof v === 'string' && TIME_RE.test(v) }

// Returns every bookable slot for the booking window as { 'YYYY-MM-DD': ['09:00', ...] },
// in the team's timezone. This is the single source of truth for "is this slot open":
// the browser only ever displays what comes back from here, and booking-confirm
// re-checks against a fresh copy before it writes anything.
export async function openSlots(admin: any, cfg: BookingSettings): Promise<Record<string, string[]>> {
  const zone = cfg.team_timezone
  const now = DateTime.now().setZone(zone)
  const today = now.startOf('day')

  const [availRes, bookedRes] = await Promise.all([
    admin.from('calendar_availability').select('day_of_week, time_slot').eq('is_available', true),
    admin.from('booked_slots').select('slot_date, time_slot').gte('slot_date', today.toISODate()),
  ])

  const byDow: Record<number, string[]> = {}
  ;(availRes.data || []).forEach((r: any) => {
    if (!isTimeStr(r.time_slot)) return
    ;(byDow[r.day_of_week] ||= []).push(r.time_slot)
  })
  Object.values(byDow).forEach(list => list.sort())

  const booked = new Set((bookedRes.data || []).map((b: any) => `${b.slot_date}|${b.time_slot}`))
  const result: Record<string, string[]> = {}

  for (let i = 0; i <= cfg.booking_window_days; i++) {
    const day = today.plus({ days: i })
    const dow = day.weekday // 1 = Monday ... 7 = Sunday
    if (dow > 5) continue
    const iso = day.toISODate()!
    const open: string[] = []

    for (const time of byDow[dow] || []) {
      if (booked.has(`${iso}|${time}`)) continue

      // Buffer: a booked slot an hour earlier blocks this one when the buffer is 30+ minutes.
      if (cfg.booking_buffer_minutes >= 30) {
        const prev = `${String(parseInt(time.split(':')[0], 10) - 1).padStart(2, '0')}:00`
        if (booked.has(`${iso}|${prev}`)) continue
      }

      const start = DateTime.fromISO(`${iso}T${time}`, { zone })
      if (!start.isValid) continue
      if (start.diff(now, 'hours').hours < cfg.booking_min_notice_hours) continue

      open.push(time)
    }
    if (open.length) result[iso] = open
  }
  return result
}

export function slotInstant(date: string, time: string, zone: string) {
  return DateTime.fromISO(`${date}T${time}`, { zone })
}

// ── Input validation ─────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function cleanText(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max) : ''
}

export function validateContact(body: Record<string, unknown>) {
  const full_name = cleanText(body.full_name, 120)
  const company_name = cleanText(body.company_name, 160)
  const email = cleanText(body.email, 254).toLowerCase()
  const phone = cleanText(body.phone, 30)
  const challenge_notes = cleanText(body.challenge_notes, 1000)
  const errors: Record<string, string> = {}

  if (full_name.length < 2) errors.full_name = 'Please enter your full name.'
  if (company_name.length < 1) errors.company_name = 'Please enter your company name.'
  if (!EMAIL_RE.test(email)) errors.email = 'Please enter a valid email address.'
  const digits = phone.replace(/\D/g, '')
  if (!/^[0-9+()\-.\s]+$/.test(phone) || digits.length < 7 || digits.length > 15) {
    errors.phone = 'Please enter a valid phone number.'
  }

  return {
    errors,
    value: {
      full_name, company_name, email, phone,
      has_whatsapp: body.has_whatsapp === true,
      challenge_notes: challenge_notes || null,
    },
  }
}

export function cleanSource(v: unknown): string {
  const s = cleanText(v, 60)
  return s || 'Website'
}

// ── Abuse protection ─────────────────────────────────────────────────────

async function sha256Hex(input: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function ipHash(req: Request) {
  const ip = (req.headers.get('cf-connecting-ip')
    || req.headers.get('x-forwarded-for')?.split(',')[0]
    || req.headers.get('x-real-ip')
    || 'unknown').trim()
  return sha256Hex(`${Deno.env.get('BOOKING_HASH_SALT') || 'sdfm-booking'}|${ip}`)
}

// True when the caller is under the limit (and records this attempt).
export async function allowRequest(admin: any, hash: string, action: string, max: number, windowMinutes: number) {
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString()
  const { count } = await admin
    .from('booking_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('ip_hash', hash).eq('action', action).gte('created_at', since)
  if ((count ?? 0) >= max) return false
  await admin.from('booking_attempts').insert({ ip_hash: hash, action })
  if (Math.random() < 0.02) admin.rpc('purge_booking_attempts').then(() => {}, () => {})
  return true
}

// Escapes % and _ so an email address is matched literally by ILIKE.
export function likeEscape(v: string) {
  return v.replace(/[\\%_]/g, m => '\\' + m)
}

// ── Lead access ──────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function isUuid(v: unknown): v is string { return typeof v === 'string' && UUID_RE.test(v) }

// A lead is only ever returned to someone who holds its id AND its secret token.
export async function getLeadByToken(admin: any, leadId: unknown, token: unknown) {
  if (!isUuid(leadId) || !isUuid(token)) return null
  const { data } = await admin.from('leads').select('*').eq('id', leadId).eq('booking_token', token).maybeSingle()
  return data || null
}

// ── Links ────────────────────────────────────────────────────────────────

export function resumeLink(lead: any) {
  return `${SITE_URL}/book?lead=${lead.id}&t=${lead.booking_token}`
}

export function prepLink(lead: any) {
  return `${SITE_URL}/book?lead=${lead.id}&t=${lead.booking_token}&prep=1`
}

export function whatsappLink(cfg: BookingSettings, text = 'Hi SDFM, I would like to talk about a free AI Gap Assessment.') {
  return `https://wa.me/${cfg.whatsapp_number}?text=${encodeURIComponent(text)}`
}

export function googleCalendarLink(cfg: BookingSettings, lead: any) {
  const start = slotInstant(lead.scheduled_date, lead.scheduled_time, cfg.team_timezone)
  if (!start.isValid) return ''
  const end = start.plus({ minutes: cfg.booking_duration_minutes })
  const fmt = (d: any) => d.toUTC().toFormat("yyyyLLdd'T'HHmmss'Z'")
  const details = [
    'Free AI Gap Assessment discovery call with SDFM Group.',
    cfg.meeting_link ? `Join: ${cfg.meeting_link}` : 'We will send the meeting link before the call.',
    `Questions? WhatsApp +${cfg.whatsapp_number}`,
  ].join('\n')
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: 'SDFM discovery call',
    dates: `${fmt(start)}/${fmt(end)}`,
    details,
    location: cfg.meeting_link || 'Google Meet',
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

// ── Qualification scoring ────────────────────────────────────────────────
// Mirrors src/lib/scoring.js (the CRM scores the same questions when staff edit
// a lead's responses). Keep the two in sync.

export const QUESTIONS: Record<string, { field: string; options: { label: string; value: string; points: number; disqualifier?: boolean }[] }> = {
  q1: { field: 'q1_revenue', options: [
    { label: 'Below KES 10 million', value: 'below_10m', points: 0, disqualifier: true },
    { label: 'KES 10 million – 50 million', value: '10m_50m', points: 2 },
    { label: 'KES 50 million – 100 million', value: '50m_100m', points: 3 },
    { label: 'KES 100 million – 500 million', value: '100m_500m', points: 4 },
    { label: 'Above KES 500 million', value: 'above_500m', points: 4 },
  ] },
  q2: { field: 'q2_challenge', options: [
    { label: 'Curious about AI, no specific problem', value: 'curious', points: 1 },
    { label: "A process that isn't working well", value: 'process_issue', points: 3 },
    { label: "Tried to fix a problem, solutions haven't worked", value: 'tried_fix', points: 4 },
    { label: 'A manual process is costing us significant time or money and we need it fixed', value: 'costly_manual', points: 5 },
  ] },
  q3: { field: 'q3_role', options: [
    { label: "I'm researching options on behalf of someone else", value: 'researcher', points: 0, disqualifier: true },
    { label: 'I influence the decision but need approval from someone above me', value: 'influencer', points: 2 },
    { label: "I'm the decision-maker with budget authority", value: 'decision_maker', points: 4 },
  ] },
  q4: { field: 'q4_priority', options: [
    { label: 'Getting the lowest possible price', value: 'lowest_price', points: 0, disqualifier: true },
    { label: 'Getting it done as fast as possible', value: 'speed', points: 3 },
    { label: 'Getting a solution tailored to how my business actually operates', value: 'tailored', points: 4 },
    { label: 'Achieving measurable results — time saved, costs reduced or revenue increased', value: 'results', points: 4 },
  ] },
  q5: { field: 'q5_timeline', options: [
    { label: 'Just exploring — no specific timeline', value: 'exploring', points: 1 },
    { label: 'Within the next 3 to 6 months', value: '3_6_months', points: 2 },
    { label: 'Within the next 1 to 3 months', value: '1_3_months', points: 3 },
    { label: 'As soon as possible', value: 'asap', points: 4 },
  ] },
}

export const HOT_MIN = 17
export const WARM_MIN = 10

// answers: { q1: 'below_10m', ... } (option values). Unknown values are ignored.
export function scoreAnswers(answers: Record<string, string>) {
  let total = 0
  let reason: string | null = null
  let answered = 0
  const out: Record<string, unknown> = {}

  for (const [key, q] of Object.entries(QUESTIONS)) {
    const opt = q.options.find(o => o.value === answers[key])
    out[q.field] = opt ? opt.label : null
    out[`${key}_score`] = opt ? opt.points : 0
    if (opt) {
      answered++
      total += opt.points
      if (opt.disqualifier) reason = `${key.toUpperCase()}: ${opt.label}`
    }
  }

  const complete = answered === Object.keys(QUESTIONS).length
  let classification = 'unscored'
  if (complete) classification = reason ? 'cold' : total >= HOT_MIN ? 'hot' : total >= WARM_MIN ? 'warm' : 'cold'

  return { fields: out, total_score: total, classification, disqualifier_reason: reason, complete }
}

// Recover option values from the labels stored on a lead, so a second partial
// submission can be merged with the first.
export function answersFromLead(lead: any): Record<string, string> {
  const answers: Record<string, string> = {}
  for (const [key, q] of Object.entries(QUESTIONS)) {
    const opt = q.options.find(o => o.label === lead[q.field])
    if (opt) answers[key] = opt.value
  }
  return answers
}
