// Inquiry tracking: an inquiry is someone who reached out (WhatsApp, phone, email ...) but is not
// a lead yet. Staff work it to a decision: convert it into a lead, or close it with a reason.
// The rules for what needs attention and how the funnel is measured live here so every screen
// that shows inquiries agrees. Data model: supabase/migration-inquiries.sql

export const CHANNELS = [
  { key: 'whatsapp', label: 'WhatsApp', leadSource: 'WhatsApp' },
  { key: 'phone', label: 'Phone call', leadSource: 'Phone Call' },
  { key: 'email', label: 'Email', leadSource: 'Email' },
  { key: 'linkedin', label: 'LinkedIn', leadSource: 'LinkedIn (Organic)' },
  { key: 'referral', label: 'Referral', leadSource: 'Referral' },
  { key: 'event', label: 'Event', leadSource: 'Event' },
  { key: 'website', label: 'Website', leadSource: 'Website' },
  { key: 'other', label: 'Other', leadSource: 'Other' },
]

export function channelLabel(key) {
  return CHANNELS.find(c => c.key === key)?.label || 'Other'
}

// The value written to leads.source when an inquiry is converted.
export function channelLeadSource(key) {
  return CHANNELS.find(c => c.key === key)?.leadSource || 'Other'
}

// new -> contacted -> engaged, then it ends as converted (a lead exists) or closed.
export const STATUSES = [
  { key: 'new', label: 'New', hint: 'Nobody has replied yet' },
  { key: 'contacted', label: 'Contacted', hint: 'We have replied' },
  { key: 'engaged', label: 'Engaged', hint: 'A real conversation is going' },
  { key: 'converted', label: 'Converted', hint: 'Became a lead' },
  { key: 'closed', label: 'Closed', hint: 'Ended without a lead' },
]

export const OPEN_STATUSES = ['new', 'contacted', 'engaged']

export function statusLabel(key) {
  return STATUSES.find(s => s.key === key)?.label || key
}

export const CLOSE_REASONS = [
  { key: 'no_response', label: 'Stopped responding' },
  { key: 'not_a_fit', label: 'Not a fit' },
  { key: 'not_interested', label: 'Not interested' },
  { key: 'duplicate', label: 'Duplicate' },
  { key: 'spam', label: 'Spam' },
  { key: 'other', label: 'Other' },
]

export function closeReasonLabel(key) {
  return CLOSE_REASONS.find(r => r.key === key)?.label || ''
}

// Touches are the activities where the team spoke to the person; the database stamps the
// inquiry's first reply / last contact from them. Notes and status changes are not touches.
export const ACTIVITY_KINDS = [
  { key: 'note', label: 'Note', touch: false },
  { key: 'call', label: 'Call', touch: true },
  { key: 'whatsapp', label: 'WhatsApp', touch: true },
  { key: 'email', label: 'Email', touch: true },
  { key: 'meeting', label: 'Meeting', touch: true },
  { key: 'status', label: 'Status', touch: false },
]

export function activityLabel(key) {
  return ACTIVITY_KINDS.find(k => k.key === key)?.label || key
}

// ── Attention rules ──
// Change these two numbers to change what the team is nudged about.
export const REPLY_TARGET_HOURS = 24      // a new inquiry unanswered for longer than this is overdue
export const QUIET_AFTER_DAYS = 7         // an open inquiry with no contact for this long has gone quiet

const HOUR = 3600000
const DAY = 86400000

export function isOpen(inq) {
  return OPEN_STATUSES.includes(inq.status)
}

export function todayISO(now = new Date()) {
  // en-CA formats as YYYY-MM-DD in the viewer's own timezone, which is what a date input holds.
  return now.toLocaleDateString('en-CA')
}

export function isFollowUpDue(inq, now = new Date()) {
  return isOpen(inq) && !!inq.next_follow_up && inq.next_follow_up <= todayISO(now)
}

export function isReplyOverdue(inq, now = new Date()) {
  return inq.status === 'new' && !inq.first_response_at && now - new Date(inq.received_at) > REPLY_TARGET_HOURS * HOUR
}

export function hasGoneQuiet(inq, now = new Date()) {
  if (!isOpen(inq) || inq.status === 'new' || inq.next_follow_up) return false
  const last = new Date(inq.last_contact_at || inq.received_at)
  return now - last > QUIET_AFTER_DAYS * DAY
}

// Why an open inquiry needs a human: [] when it is fine.
export function attentionReasons(inq, now = new Date()) {
  const reasons = []
  if (isReplyOverdue(inq, now)) reasons.push('Reply overdue')
  if (isFollowUpDue(inq, now)) reasons.push('Follow-up due')
  if (hasGoneQuiet(inq, now)) reasons.push('Gone quiet')
  return reasons
}

// ── Numbers ──

export function median(values) {
  const v = values.filter(n => Number.isFinite(n)).sort((a, b) => a - b)
  if (v.length === 0) return null
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

// Minutes from receiving an inquiry to the first reply. Negative values (a backdated received_at
// that is later than the reply) are dropped rather than shown as nonsense.
export function minutesToFirstReply(inq) {
  if (!inq.first_response_at) return null
  const m = (new Date(inq.first_response_at) - new Date(inq.received_at)) / 60000
  return m >= 0 ? m : null
}

export function daysToConvert(inq) {
  if (inq.status !== 'converted' || !inq.converted_at) return null
  const d = (new Date(inq.converted_at) - new Date(inq.received_at)) / DAY
  return d >= 0 ? d : null
}

export function formatMinutes(mins) {
  if (mins == null) return '—'
  if (mins < 1) return '<1 min'
  if (mins < 60) return `${Math.round(mins)} min`
  if (mins < 60 * 48) return `${Math.round(mins / 60)} h`
  return `${Math.round(mins / 1440)} d`
}

export function formatDays(days) {
  if (days == null) return '—'
  if (days < 1) return '<1 day'
  return `${Math.round(days)} day${Math.round(days) === 1 ? '' : 's'}`
}

// Funnel numbers for a set of inquiries (already filtered to the period being looked at).
export function summarise(inquiries) {
  const received = inquiries.length
  const converted = inquiries.filter(i => i.status === 'converted')
  const closed = inquiries.filter(i => i.status === 'closed')
  const replied = inquiries.filter(i => i.first_response_at)
  return {
    received,
    open: inquiries.filter(isOpen).length,
    converted: converted.length,
    closed: closed.length,
    conversionRate: received > 0 ? Math.round((converted.length / received) * 100) : 0,
    repliedRate: received > 0 ? Math.round((replied.length / received) * 100) : 0,
    medianReplyMinutes: median(inquiries.map(minutesToFirstReply)),
    medianDaysToConvert: median(converted.map(daysToConvert)),
  }
}

// One row per channel, busiest first.
export function byChannel(inquiries) {
  return CHANNELS
    .map(c => {
      const rows = inquiries.filter(i => i.channel === c.key)
      return { channel: c.key, label: c.label, ...summarise(rows) }
    })
    .filter(r => r.received > 0)
    .sort((a, b) => b.received - a.received)
}

// ── Matching people ──

// Last 9 digits, so 0712 345 678, +254712345678 and 254712345678 all match.
export function phoneKey(phone) {
  const digits = String(phone || '').replace(/\D/g, '')
  return digits.length >= 9 ? digits.slice(-9) : ''
}

export function emailKey(email) {
  return String(email || '').trim().toLowerCase()
}

// Existing inquiries and leads that look like the same person (same email or phone).
export function findMatches({ email, phone }, inquiries, leads, excludeInquiryId = null) {
  const e = emailKey(email)
  const p = phoneKey(phone)
  if (!e && !p) return { inquiries: [], leads: [] }
  const same = row => (e && emailKey(row.email) === e) || (p && phoneKey(row.phone) === p)
  return {
    inquiries: inquiries.filter(i => i.id !== excludeInquiryId && same(i)),
    leads: leads.filter(same),
  }
}

export function isMissingTable(error) {
  // 42P01 = Postgres undefined_table; PGRST205 = PostgREST "table not in schema cache".
  if (!error) return false
  const msg = error.message || ''
  return error.code === '42P01' || error.code === 'PGRST205' || (/inquiries/.test(msg) && /(does not exist|schema cache)/.test(msg))
}

// ── Display ──

export function shortDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function shortDateTime(value) {
  if (!value) return '—'
  const d = new Date(value)
  return `${shortDate(d)}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
}

// A date-only value (YYYY-MM-DD, e.g. next_follow_up) read as a local calendar day.
export function shortDay(value) {
  if (!value) return '—'
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export function timeAgo(value, now = new Date()) {
  const ms = now - new Date(value)
  const mins = Math.floor(ms / 60000)
  const hrs = Math.floor(ms / HOUR)
  const days = Math.floor(ms / DAY)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  if (hrs < 24) return `${hrs}h ago`
  if (days < 14) return `${days}d ago`
  return shortDate(value)
}

// <input type="datetime-local"> wants local wall-clock time without a zone.
export function toLocalInput(date) {
  const p = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`
}
