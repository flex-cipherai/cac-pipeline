import { DateTime } from 'luxon'
import { supabase } from './supabase'
import { platformOf } from './platforms'

// Best times to post for a set of accounts, as heatmap cells
// [{ weekday 1-7, hour, value (avg engagement rate %), posts }].
// Built from the social_best_times view (the BMS's own published posts).
// With fewer than MIN_POSTS published posts it falls back to the platforms'
// industry defaults (src/lib/platforms.js), flagged isDefault so the UI says so.
export const MIN_POSTS = 10

export async function fetchBestTimes(accounts) {
  const ids = accounts.map(a => a.id)
  if (!ids.length) return { cells: [], isDefault: true, sample: 0 }
  const { data } = await supabase.from('social_best_times').select('*').in('account_id', ids)
  const rows = data || []
  const sample = rows.reduce((s, r) => s + (r.posts || 0), 0)

  if (sample >= MIN_POSTS) {
    const map = new Map()
    for (const r of rows) {
      const key = `${r.weekday}-${r.hour}`
      const cur = map.get(key) || { weekday: r.weekday, hour: r.hour, weighted: 0, posts: 0 }
      cur.weighted += (Number(r.avg_engagement_rate) || 0) * r.posts
      cur.posts += r.posts
      map.set(key, cur)
    }
    return {
      cells: [...map.values()].map(c => ({ weekday: c.weekday, hour: c.hour, value: c.posts ? c.weighted / c.posts : 0, posts: c.posts })),
      isDefault: false,
      sample,
    }
  }

  const map = new Map()
  for (const a of accounts) {
    for (const t of platformOf(a).defaultBestTimes || []) {
      const key = `${t.weekday}-${t.hour}`
      map.set(key, { weekday: t.weekday, hour: t.hour, value: (map.get(key)?.value || 0) + 1 })
    }
  }
  return { cells: [...map.values()], isDefault: true, sample }
}

// The top N best slots, as { weekday, time: 'HH:00' } — used to suggest queue slots.
export function topSlots(cells, n = 5) {
  return [...cells].sort((a, b) => (b.value || 0) - (a.value || 0)).slice(0, n)
    .map(c => ({ weekday: c.weekday, time: `${String(c.hour).padStart(2, '0')}:00` }))
}

// ── Queue ──────────────────────────────────────────────────────

// Slot instants for an account between two DateTimes (account's timezone → local).
export function slotInstants(slots, timezone, from, to) {
  const out = []
  let day = from.setZone(timezone).startOf('day')
  const end = to.setZone(timezone)
  while (day <= end) {
    for (const s of slots) {
      if (!s.active && s.active !== undefined) continue
      if (s.weekday !== day.weekday) continue
      const [h, m] = String(s.slot_time || s.time).split(':').map(Number)
      const at = day.set({ hour: h, minute: m, second: 0, millisecond: 0 })
      if (at > from && at <= to) out.push(at.toLocal())
    }
    day = day.plus({ days: 1 })
  }
  return out.sort((a, b) => a.toMillis() - b.toMillis())
}

// Next free queue slot for an account (at least 10 minutes from now, no other
// post of that account at the same minute). Returns a luxon DateTime or null
// when the account has no slots.
export async function nextQueueSlot(account) {
  const { data: slots } = await supabase.from('posting_slots').select('*').eq('account_id', account.id).eq('active', true)
  if (!slots?.length) return null
  const from = DateTime.now().plus({ minutes: 10 })
  const to = from.plus({ days: 60 })
  const { data: taken } = await supabase.from('posts').select('scheduled_at')
    .eq('account_id', account.id).eq('is_template', false)
    .in('status', ['scheduled', 'pending_approval', 'publishing', 'ready_to_post'])
    .gte('scheduled_at', from.toISO()).lte('scheduled_at', to.toISO())
  const takenMinutes = new Set((taken || []).map(p => DateTime.fromISO(p.scheduled_at).startOf('minute').toMillis()))
  return slotInstants(slots, account.timezone || 'Africa/Nairobi', from, to)
    .find(at => !takenMinutes.has(at.startOf('minute').toMillis())) || null
}
