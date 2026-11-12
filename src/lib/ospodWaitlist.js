// Ospod waitlist: the signups from the Ospod landing pages (page: pages/OspodWaitlist.jsx).
// Data model and rules: supabase/migration-ospod-waitlist.sql; the landing pages live in the separate ospod repo.

export const FOUNDING_CAP = 500

// Follow-up stages. The classes reuse the colours the Inquiries page already has.
export const STATUSES = [
  { key: 'new', label: 'New', tone: 'new' },
  { key: 'contacted', label: 'Contacted', tone: 'contacted' },
  { key: 'call_booked', label: 'Call booked', tone: 'engaged' },
  { key: 'interviewed', label: 'Interviewed', tone: 'converted' },
  { key: 'not_a_fit', label: 'Not a fit', tone: 'closed' },
]

export function statusLabel(key) {
  return STATUSES.find(s => s.key === key)?.label || key
}

export function statusTone(key) {
  return STATUSES.find(s => s.key === key)?.tone || 'new'
}

export function pageLabel(variant) {
  return variant === 'studios' ? 'Studios (LinkedIn)' : 'Podcasters (Instagram)'
}

// The ad variant tag the page was opened with (ig_30, li_15 ...), or 'untagged'.
export function adTag(row) {
  return row.utm_content || 'untagged'
}

export function sourceLabel(row) {
  const parts = [
    [row.utm_source, row.utm_medium].filter(Boolean).join(' / '),
    row.utm_campaign,
    row.utm_content,
  ].filter(Boolean)
  if (parts.length) return parts.join(' · ')
  if (row.referrer) return `Referred by ${row.referrer}`
  return 'Direct or unknown'
}

// Rough monthly editing spend in USD, from the answer's wording, to rank people by what they pay today.
// 'I edit myself' counts as 0 (their cost is time, not money). The top bands use the lower bound.
const SPEND_FLOOR = {
  'I edit myself': 0,
  'Under $100': 1,
  '$100 to $500': 100,
  '$500 to $2,000': 500,
  '$2,000+': 2000,
}

export function spendFloor(row) {
  return SPEND_FLOOR[row.spend] ?? 0
}

export const SPEND_ORDER = ['I edit myself', 'Under $100', '$100 to $500', '$500 to $2,000', '$2,000+']

// [{ label, count }] for one field, in the given order first (so spend reads low to high), then anything else.
export function tally(rows, pick, order = []) {
  const counts = new Map()
  for (const r of rows) {
    const k = pick(r)
    counts.set(k, (counts.get(k) || 0) + 1)
  }
  const known = order.filter(k => counts.has(k)).map(k => ({ label: k, count: counts.get(k) }))
  const rest = [...counts.entries()]
    .filter(([k]) => !order.includes(k))
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count }))
  return [...known, ...rest]
}

export function summarise(rows) {
  const total = rows.length
  const studios = rows.filter(r => r.variant === 'studios').length
  const payers = rows.filter(r => spendFloor(r) >= 100).length
  const founding = rows.filter(r => r.member_no <= FOUNDING_CAP).length
  const now = Date.now()
  const last7 = rows.filter(r => now - new Date(r.created_at).getTime() < 7 * 86400000).length
  return { total, studios, payers, founding, last7 }
}
