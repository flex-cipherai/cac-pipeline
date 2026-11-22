// Sales pipeline: the shared vocabulary for the board, the lead drawer and the dashboard.
//
// One pipeline per service line. Custom builds is the only line live today; an industry solution gets its
// own entry in SERVICE_LINES (and its own board) when one launches.
//
// Stages:
//   1 Scoper   ran the free Automation scoper, anonymously (a gap_assessments row with no pipeline lead)
//   2 Active   left their details at the end of the scoper, asked for a custom build on the website, or
//              was added by staff (pipeline_leads.stage = 'active')
//   3 Client   converted (stage = 'client'). 'lost' takes a lead off the board without deleting it.
//
// The 48-hour rule (STALE_AFTER_HOURS, isStale) must match supabase/functions/_shared/pipelineAlerts.ts,
// which emails the admins. classifySource must match supabase/functions/_shared/pipelineSource.ts.

export const SERVICE_LINES = [
  { key: 'custom_build', label: 'Custom builds', live: true },
  { key: 'industry', label: 'Industry solutions', live: false, note: 'Each industry solution gets its own pipeline when it launches.' },
]

export const STAGES = [
  { key: 'scoper', step: 1, label: 'Ran the scoper', short: 'Scoper', hint: 'Used the free Automation scoper. Anonymous until they ask to be contacted.' },
  { key: 'active', step: 2, label: 'Active leads', short: 'Active', hint: 'Left their details or asked for a custom build. Log every interaction.' },
  { key: 'client', step: 3, label: 'Clients', short: 'Client', hint: 'Converted.' },
]

export const STALE_AFTER_HOURS = 48
const HOUR = 3_600_000

export const SOURCES = [
  { key: 'direct', label: 'Direct', short: 'Direct', color: '#6b7280' },
  { key: 'linkedin_organic', label: 'LinkedIn (organic)', short: 'LinkedIn', color: '#0a66c2' },
  { key: 'linkedin_paid', label: 'LinkedIn (paid)', short: 'LinkedIn ads', color: '#004182' },
  { key: 'meta_organic', label: 'Meta (organic)', short: 'Meta', color: '#c13584' },
  { key: 'meta_paid', label: 'Meta (paid)', short: 'Meta ads', color: '#7b2cbf' },
  { key: 'email', label: 'Email', short: 'Email', color: '#0e7490' },
  { key: 'other', label: 'Other', short: 'Other', color: '#a16207' },
]
export const SOURCE_BY_KEY = Object.fromEntries(SOURCES.map(s => [s.key, s]))

export const ENTRY_POINTS = {
  scoper: 'Automation scoper',
  custom_build_form: 'Custom build form',
  manual: 'Added by staff',
}

// What a logged interaction can be. Only the five mediums count as an interaction for the 48-hour rule.
export const MEDIUMS = [
  { key: 'phone_call', label: 'Phone call', verb: 'Called' },
  { key: 'e_meeting', label: 'E-meeting', verb: 'Online meeting' },
  { key: 'physical_meeting', label: 'Physical meeting', verb: 'Met in person' },
  { key: 'email', label: 'Email', verb: 'Emailed' },
  { key: 'whatsapp', label: 'WhatsApp', verb: 'WhatsApp chat' },
]
export const MEDIUM_BY_KEY = Object.fromEntries([...MEDIUMS, { key: 'note', label: 'Note', verb: 'Note' }, { key: 'stage', label: 'Stage change', verb: 'Stage' }].map(m => [m.key, m]))
export const INTERACTION_MEDIUMS = MEDIUMS.map(m => m.key)

export const LOST_REASONS = [
  'Unresponsive after several follow-ups',
  'Not ready yet / timing',
  'Budget',
  'Went with someone else',
  'Not a fit for a custom build',
  'Other',
]

// ── 48-hour rule ──────────────────────────────────────────────────────

export function quietSince(lead) {
  return new Date(lead.last_interaction_at || lead.created_at)
}

export function hoursQuiet(lead, now = new Date()) {
  return (now.getTime() - quietSince(lead).getTime()) / HOUR
}

export function isStale(lead, now = new Date()) {
  return lead.stage === 'active' && hoursQuiet(lead, now) >= STALE_AFTER_HOURS
}

// Hours left before the flag, for the "due in 6h" hint on fresh leads.
export function hoursUntilStale(lead, now = new Date()) {
  return Math.max(0, STALE_AFTER_HOURS - hoursQuiet(lead, now))
}

// ── Source ────────────────────────────────────────────────────────────

const PAID = /^(cpc|ppc|cpm|cpv|paid|paid[_-]?social|paidsocial|social[_-]?paid|ads?|display|sponsored)$/
const LINKEDIN = /linkedin|lnkd/
const META = /facebook|instagram|^fb$|^ig$|^meta$|messenger|threads/
const EMAIL = /e-?mail|newsletter|mailchimp|resend|brevo|sendgrid|klaviyo/

function hostOf(url) {
  if (!url) return ''
  try { return new URL(url).hostname.toLowerCase() } catch { return '' }
}
function paramOf(url, key) {
  if (!url) return ''
  try { return new URL(url).searchParams.get(key) || '' } catch { return '' }
}

export function classifySource(h, ownHosts = ['sdfmgroup.com']) {
  if (h.source_channel && SOURCE_BY_KEY[h.source_channel]) return h.source_channel
  const src = String(h.utm_source || paramOf(h.page_url, 'utm_source') || '').trim().toLowerCase()
  const med = String(h.utm_medium || paramOf(h.page_url, 'utm_medium') || '').trim().toLowerCase()
  const ref = hostOf(h.referrer)
  const paid = PAID.test(med) || !!paramOf(h.page_url, 'li_fat_id') || (!!paramOf(h.page_url, 'fbclid') && !!src)
  if (src || med) {
    if (LINKEDIN.test(src)) return paid ? 'linkedin_paid' : 'linkedin_organic'
    if (META.test(src)) return paid ? 'meta_paid' : 'meta_organic'
    if (EMAIL.test(src) || EMAIL.test(med)) return 'email'
  }
  if (ref) {
    if (/(^|\.)linkedin\.com$|(^|\.)lnkd\.in$/.test(ref)) return 'linkedin_organic'
    if (/(^|\.)(facebook|instagram|threads)\.(com|net)$|(^|\.)fb\.me$|(^|\.)m\.me$/.test(ref)) return 'meta_organic'
    if (/mail\.|outlook\.|mail\.google\.com$/.test(ref)) return 'email'
    if (!ownHosts.some(o => ref === o || ref.endsWith('.' + o))) return 'other'
  }
  if (src || med) return 'other'
  if (h.heard_from === 'linkedin') return 'linkedin_organic'
  if (h.heard_from === 'instagram') return 'meta_organic'
  if (h.heard_from === 'other') return 'other'
  return 'direct'
}

// ── Formatting ────────────────────────────────────────────────────────

export function timeAgo(iso, now = new Date()) {
  if (!iso) return ''
  const mins = Math.round((now.getTime() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const h = Math.round(mins / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 14) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export function money(n, currency = 'KES') {
  if (n == null || n === '' || Number.isNaN(Number(n))) return ''
  const v = Number(n)
  const compact = v >= 1_000_000 ? `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M` : v >= 10_000 ? `${Math.round(v / 1000)}K` : Math.round(v).toLocaleString('en-US')
  return `${currency} ${compact}`
}

export function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || '?'
}

export function pct(part, whole) {
  return whole > 0 ? Math.round((part / whole) * 100) : 0
}
