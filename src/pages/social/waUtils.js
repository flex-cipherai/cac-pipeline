// Pure helpers for the Website Analytics page: date ranges, series filling,
// formatting, goals/funnels and country names. No React, so they can be
// tested with plain Node.
import { DateTime } from 'luxon'

export const DEFAULT_TZ = 'Africa/Nairobi'

export const PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: '90d', label: 'Last 90 days' },
  { key: 'month', label: 'This month' },
  { key: 'lastmonth', label: 'Last month' },
  { key: '12mo', label: 'Last 12 months' },
  { key: 'all', label: 'All time' },
  { key: 'custom', label: 'Custom range' },
]

export const COMPARE = [
  { key: 'prev', label: 'Previous period' },
  { key: 'year', label: 'Same period last year' },
  { key: 'off', label: 'No comparison' },
]

// Site filters. `key` is the p_filters key sent to web_analytics_report.
export const FILTERS = {
  channel: 'Channel', source: 'Source', referrer: 'Referrer', campaign: 'Campaign',
  page: 'Page', entry: 'Entry page', exit: 'Exit page',
  device: 'Device', browser: 'Browser', os: 'OS',
  country: 'Country', language: 'Language', hostname: 'Hostname', goal: 'Goal',
}

// Keys match wa_event_goal() in supabase/migration-website-analytics-v2.sql.
// `conversion: false` = counted as a goal but not as a conversion.
export const GOALS = [
  { key: 'scoper_contact', label: 'Scoper: asked to be contacted', group: 'Lead', conversion: true },
  { key: 'custom_build', label: 'Custom-build request sent', group: 'Lead', conversion: true },
  { key: 'industry_enquiry', label: 'Industry-solutions enquiry', group: 'Lead', conversion: true },
  { key: 'contact_form', label: 'Contact form sent', group: 'Lead', conversion: true },
  { key: 'scoper_report', label: 'Scoper: got a report', group: 'Scoper', conversion: true },
  { key: 'scoper_start', label: 'Scoper: started', group: 'Scoper', conversion: false },
  { key: 'whatsapp', label: 'WhatsApp click', group: 'Contact', conversion: true },
  { key: 'phone', label: 'Phone click', group: 'Contact', conversion: true },
  { key: 'email', label: 'Email click', group: 'Contact', conversion: true },
]
export const goalLabel = key => GOALS.find(g => g.key === key)?.label || key

export const FUNNELS = [
  {
    key: 'scoper', label: 'Automation scoper', goal: 'scoper_contact',
    steps: ['All visits', 'Opened the scoper', 'Started a review', 'Answered the first question', 'Got the report', 'Left details to be contacted'],
  },
  {
    key: 'contact', label: 'Contact form', goal: 'contact_form',
    steps: ['All visits', 'Viewed the contact page', 'Started the contact form', 'Sent a message'],
  },
  {
    key: 'custom', label: 'Custom build request', goal: 'custom_build',
    steps: ['All visits', 'Viewed Custom builds', 'Started the request form', 'Sent the request'],
  },
]

// Headline metrics. `invert` = lower is better (for deltas and colour).
export const METRICS = [
  { key: 'visitors', label: 'Unique visitors', fmt: 'num' },
  { key: 'visits', label: 'Total visits', fmt: 'num' },
  { key: 'pageviews', label: 'Pageviews', fmt: 'num' },
  { key: 'views_per_visit', label: 'Views per visit', fmt: 'dec' },
  { key: 'bounce_rate', label: 'Bounce rate', fmt: 'pct', invert: true },
  { key: 'visit_duration', label: 'Visit duration', fmt: 'dur' },
  { key: 'conversions', label: 'Conversions', fmt: 'num' },
  { key: 'conversion_rate', label: 'Conversion rate', fmt: 'pct' },
]

export const SEO_METRICS = [
  { key: 'clicks', label: 'Clicks', fmt: 'num' },
  { key: 'impressions', label: 'Impressions', fmt: 'num' },
  { key: 'ctr', label: 'Click-through rate', fmt: 'pct2' },
  { key: 'position', label: 'Average position', fmt: 'dec1', invert: true },
]

// ── formatting ──
export const num = n => Number(n || 0).toLocaleString('en-US')

export function fmtDuration(seconds) {
  const s = Math.round(Number(seconds) || 0)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

export function fmtMinutes(minutes) {
  const m = Math.round(Number(minutes) || 0)
  if (m < 60) return `${m} min`
  if (m < 60 * 48) return `${Math.round(m / 6) / 10} h`
  return `${Math.round(m / 144) / 10} days`
}

export function fmtValue(v, fmt) {
  if (v == null || Number.isNaN(Number(v))) return '—'
  const n = Number(v)
  switch (fmt) {
    case 'pct': return `${(Math.round(n * 10) / 10).toLocaleString('en-US')}%`
    case 'pct2': return `${n.toFixed(n >= 10 ? 1 : 2)}%`
    case 'dec': return n.toFixed(2).replace(/\.?0+$/, '') || '0'
    case 'dec1': return n.toFixed(1)
    case 'dur': return fmtDuration(n)
    default: return n >= 10000 ? compact(n) : num(n)
  }
}

export function compact(n) {
  const v = Number(n || 0)
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1).replace(/\.0$/, '')}M`
  if (Math.abs(v) >= 1e4) return `${(v / 1e3).toFixed(1).replace(/\.0$/, '')}k`
  return num(v)
}

export const pctOf = (a, b) => (b > 0 ? (a / b) * 100 : 0)

// Percent change; null when there is nothing to compare against.
export function change(cur, prev) {
  if (prev == null || cur == null) return null
  const c = Number(cur), p = Number(prev)
  if (p === 0) return c === 0 ? 0 : null
  return ((c - p) / Math.abs(p)) * 100
}

// ── date ranges ──
// Returns query bounds for one period in the team time zone. `to` is
// exclusive (timestamps); `toDate` is inclusive (Search Console dates).
// `cmp` is the comparison window, or null.
export function resolveRange({ period, from: cFrom, to: cTo, compare = 'prev' }, tz = DEFAULT_TZ, now = DateTime.now()) {
  const today = now.setZone(tz).startOf('day')
  let start, end, interval, label
  switch (period) {
    case 'today': start = today; end = today.plus({ days: 1 }); interval = 'hour'; label = 'Today'; break
    case 'yesterday': start = today.minus({ days: 1 }); end = today; interval = 'hour'; label = 'Yesterday'; break
    case '7d': start = today.minus({ days: 6 }); end = today.plus({ days: 1 }); interval = 'day'; label = 'Last 7 days'; break
    case '90d': start = today.minus({ days: 89 }); end = today.plus({ days: 1 }); interval = 'day'; label = 'Last 90 days'; break
    case 'month': start = today.startOf('month'); end = today.plus({ days: 1 }); interval = 'day'; label = today.toFormat('LLLL yyyy'); break
    case 'lastmonth': start = today.startOf('month').minus({ months: 1 }); end = today.startOf('month'); interval = 'day'; label = start.toFormat('LLLL yyyy'); break
    case '12mo': start = today.startOf('month').minus({ months: 11 }); end = today.plus({ days: 1 }); interval = 'month'; label = 'Last 12 months'; break
    case 'all': return { period, from: null, to: null, fromDate: null, toDate: null, interval: 'month', label: 'All time', cmp: null, start: null, end: today.plus({ days: 1 }) }
    case 'custom': {
      const s = DateTime.fromISO(cFrom || '', { zone: tz }).startOf('day')
      const l = DateTime.fromISO(cTo || cFrom || '', { zone: tz }).startOf('day')
      if (s.isValid && l.isValid && l >= s) {
        start = s; end = l.plus({ days: 1 })
        const days = Math.round(end.diff(start, 'days').days)
        interval = days <= 2 ? 'hour' : days > 120 ? 'month' : 'day'
        label = days === 1 ? s.toFormat('ccc d LLL yyyy')
          : `${s.toFormat(s.year === l.year ? 'd LLL' : 'd LLL yyyy')} – ${l.toFormat('d LLL yyyy')}`
        break
      }
      return resolveRange({ period: '30d', compare }, tz, now)
    }
    default: start = today.minus({ days: 29 }); end = today.plus({ days: 1 }); interval = 'day'; label = 'Last 30 days'
  }

  let cmp = null
  if (compare === 'prev') {
    // "This month" so far compares with the same number of days last month.
    if (period === 'month' || period === 'lastmonth') {
      const cs = start.minus({ months: 1 })
      cmp = { start: cs, end: period === 'month' ? cs.plus(end.diff(start)) : start }
    } else if (period === '12mo') {
      cmp = { start: start.minus({ months: 12 }), end: start }
    } else {
      cmp = { start: start.minus(end.diff(start)), end: start }
    }
  } else if (compare === 'year') {
    cmp = { start: start.minus({ years: 1 }), end: end.minus({ years: 1 }) }
  }
  const pack = (s, e) => ({
    start: s, end: e,
    from: s.toJSDate(), to: e.toJSDate(),
    fromDate: s.toISODate(), toDate: e.minus({ days: 1 }).toISODate(),
  })
  const out = { period, interval, label, ...pack(start, end), cmp: cmp ? pack(cmp.start, cmp.end) : null }
  if (out.cmp) out.cmp.label = describeSpan(cmp.start, cmp.end)
  return out
}

function describeSpan(s, e) {
  const last = e.minus({ days: 1 })
  if (last <= s) return s.toFormat('d LLL yyyy')
  return `${s.toFormat(s.year === last.year ? 'd LLL' : 'd LLL yyyy')} – ${last.toFormat('d LLL yyyy')}`
}

// Bucket keys in the format web_analytics_report returns (to_char in SQL).
export function bucketKey(dt, interval) {
  if (interval === 'hour') return dt.toFormat("yyyy-MM-dd'T'HH:00")
  if (interval === 'month') return dt.toFormat('yyyy-MM')
  if (interval === 'week') return dt.startOf('week').toISODate()
  return dt.toISODate()
}

export function bucketLabel(dt, interval, long = false) {
  if (interval === 'hour') return long ? dt.toFormat('ccc d LLL, HH:00') : dt.toFormat('HH:00')
  if (interval === 'month') return long ? dt.toFormat('LLLL yyyy') : dt.toFormat('LLL yy')
  if (interval === 'week') return long ? `Week of ${dt.toFormat('d LLL yyyy')}` : dt.toFormat('d LLL')
  return long ? dt.toFormat('ccc d LLL yyyy') : dt.toFormat('d LLL')
}

// Every bucket between start and end (capped at "now" so today's empty
// future hours are not drawn as zeros), with values from `rows`.
export function fillSeries(rows, { start, end, interval }, tz, keys, dateKey = 'bucket', now = DateTime.now()) {
  const map = new Map((rows || []).map(r => [r[dateKey], r]))
  let s = start
  if (!s) {
    const firstKey = (rows || []).map(r => r[dateKey]).sort()[0]
    if (!firstKey) return []
    s = DateTime.fromISO(firstKey, { zone: tz })
  }
  s = s.setZone(tz)
  const nowZ = now.setZone(tz)
  const stop = DateTime.min(end.setZone(tz),
    interval === 'hour' ? nowZ.startOf('hour').plus({ hours: 1 }) : nowZ.startOf('day').plus({ days: 1 }))
  const unit = { hour: 'hours', day: 'days', week: 'weeks', month: 'months' }[interval]
  let cur = interval === 'week' ? s.startOf('week') : interval === 'month' ? s.startOf('month') : s
  const out = []
  let guard = 0
  while (cur < stop && guard++ < 2000) {
    const key = bucketKey(cur, interval)
    const row = map.get(key)
    const point = { key, dt: cur, label: bucketLabel(cur, interval), longLabel: bucketLabel(cur, interval, true) }
    keys.forEach(k => { point[k] = row && row[k] != null ? Number(row[k]) : (row ? null : 0) })
    point.empty = !row
    out.push(point)
    cur = cur.plus({ [unit]: 1 })
  }
  return out
}

// ── countries ──
const ISO3 = {
  KEN: 'KE', UGA: 'UG', TZA: 'TZ', RWA: 'RW', ETH: 'ET', SOM: 'SO', SSD: 'SS', SDN: 'SD', BDI: 'BI', NGA: 'NG',
  GHA: 'GH', CIV: 'CI', SEN: 'SN', ZAF: 'ZA', ZWE: 'ZW', ZMB: 'ZM', MOZ: 'MZ', MWI: 'MW', BWA: 'BW', NAM: 'NA',
  EGY: 'EG', MAR: 'MA', DZA: 'DZ', TUN: 'TN', COD: 'CD', AGO: 'AO', CMR: 'CM', MUS: 'MU', MDG: 'MG',
  GBR: 'GB', IRL: 'IE', FRA: 'FR', DEU: 'DE', NLD: 'NL', BEL: 'BE', CHE: 'CH', AUT: 'AT', ESP: 'ES', PRT: 'PT',
  ITA: 'IT', SWE: 'SE', NOR: 'NO', DNK: 'DK', FIN: 'FI', POL: 'PL', CZE: 'CZ', SVK: 'SK', HUN: 'HU', ROU: 'RO',
  GRC: 'GR', TUR: 'TR', UKR: 'UA', RUS: 'RU', MNE: 'ME', SRB: 'RS', BGR: 'BG', HRV: 'HR',
  USA: 'US', CAN: 'CA', MEX: 'MX', BRA: 'BR', ARG: 'AR', COL: 'CO', PER: 'PE', CHL: 'CL',
  ARE: 'AE', SAU: 'SA', QAT: 'QA', KWT: 'KW', BHR: 'BH', OMN: 'OM', ISR: 'IL', JOR: 'JO', LBN: 'LB', IRN: 'IR',
  PAK: 'PK', IND: 'IN', BGD: 'BD', LKA: 'LK', NPL: 'NP', THA: 'TH', IDN: 'ID', SGP: 'SG', MYS: 'MY', PHL: 'PH',
  VNM: 'VN', HKG: 'HK', CHN: 'CN', TWN: 'TW', KOR: 'KR', JPN: 'JP', AUS: 'AU', NZL: 'NZ',
}

let regionNames = null
function regionName(code) {
  try {
    regionNames = regionNames || new Intl.DisplayNames(['en'], { type: 'region' })
    return regionNames.of(code) || code
  } catch {
    return code
  }
}

export function countryInfo(code) {
  if (!code || code === 'ZZ') return { name: 'Unknown', code: '??' }
  const two = code.length === 3 ? ISO3[code.toUpperCase()] : code.toUpperCase()
  if (!two) return { name: code, code: code.slice(0, 2).toUpperCase() }
  return { name: regionName(two), code: two }
}

let langNames = null
export function languageName(code) {
  if (!code || code === 'unknown') return 'Unknown'
  try {
    langNames = langNames || new Intl.DisplayNames(['en'], { type: 'language' })
    return langNames.of(code) || code
  } catch {
    return code
  }
}

// "Channel is Social" for a filter chip.
export function filterValueLabel(key, value) {
  if (key === 'country') return countryInfo(value).name
  if (key === 'language') return languageName(value)
  if (key === 'goal') return goalLabel(value)
  return value
}
