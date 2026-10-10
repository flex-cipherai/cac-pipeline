import { useState, useEffect, useMemo, useRef } from 'react'
import { DateTime } from 'luxon'
import { supabase } from '../../lib/supabase'
import { exportCSV } from '../../lib/exportUtils'
import { QUALIFICATION_QUESTIONS } from '../../lib/scoring'
import { getTrackerSnippet } from '../../lib/analytics'
import PeriodSelector, { getPeriodLabel } from '../../components/PeriodSelector/PeriodSelector'
import '../Dashboard.css'
import '../MarketingAnalytics.css'
import './SocialAnalytics.css'
import './WebsiteAnalytics.css'

// Website Analytics answers three questions, in this order:
//   1. How are people finding us?            -> Acquisition + Search (SEO) tabs
//   2. What are they doing on the website?   -> Behavior tab
//   3. Are they becoming qualified leads?    -> Conversion tab
// All aggregation happens in Postgres (web_analytics_* / seo_overview RPCs):
// PostgREST silently caps responses at 1,000 rows, which would make
// event-level reports wrong if we summed them in the browser.

const TABS = [
  { key: 'acquisition', label: 'Acquisition' },
  { key: 'seo', label: 'Search (SEO)' },
  { key: 'behavior', label: 'Behavior' },
  { key: 'conversion', label: 'Conversion' },
]

const PRESETS = [
  { key: '7d', label: '7 days', days: 7 },
  { key: '30d', label: '30 days', days: 30 },
  { key: '90d', label: '90 days', days: 90 },
  { key: 'month', label: 'Month' },
  { key: 'all', label: 'All time' },
]

const FUNNEL_STEPS = [
  { key: 'sessions', label: 'Website sessions' },
  { key: 'viewed_form', label: 'Opened the booking page' },
  { key: 'started_form', label: 'Started filling it in' },
  { key: 'contact_done', label: 'Saved contact details — lead created' },
  { key: 'picked_slot', label: 'Picked a call time' },
  { key: 'submitted', label: 'Booked the call' },
  { key: 'prep_done', label: 'Answered the prep questions (optional)' },
  { key: 'qualified', label: 'Hot or warm lead' },
]

const STEP_LABELS = { 1: 'Contact details', 2: 'Pick a time', 3: 'Booked' }

// The ways a visitor can get in touch. Only "book" ends up in the leads table;
// the other three happen outside the site, so they are tracked as clicks only.
const METHODS = [
  { key: 'book', label: 'Book on the site' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'phone', label: 'Phone call' },
  { key: 'email', label: 'Email' },
]

// Where each call-to-action sits, from data-sdfm-label in sdfmgroup.com's markup.
// A label not listed here (a CTA added later) is shown as written.
const CTA_PLACEMENTS = {
  nav_book: 'Top navigation',
  hero_book: 'Hero', hero_whatsapp: 'Hero',
  offer_book: 'Offer section', offer_whatsapp: 'Offer section',
  contact_book: 'Contact section', contact_whatsapp: 'Contact section', contact_phone: 'Contact section', contact_email: 'Contact section',
  footer_phone: 'Footer', footer_email: 'Footer',
  mobile_book: 'Mobile action bar', mobile_whatsapp: 'Mobile action bar',
  book_nav_whatsapp: 'Booking page · header',
  book_side_whatsapp: 'Booking page · sidebar', book_side_phone: 'Booking page · sidebar', book_side_email: 'Booking page · sidebar',
  book_empty_whatsapp: 'Booking page · no times open',
  book_done_whatsapp: 'Booking page · after booking',
  book_message_whatsapp: 'Booking page · error screen',
  download_ics: 'Booking page · add to calendar',
}

// What the booking page reports as form_error.stage.
const ERROR_STAGES = {
  start: 'Contact details could not be saved',
  slot_taken: 'Chosen time was taken by someone else',
  confirm: 'Booking could not be confirmed',
  rate_limited: 'Blocked for too many attempts',
  already_booked: 'Already had a call booked',
}

const DEFAULT_TZ = 'Africa/Nairobi'

// ── formatting helpers ──
const num = n => Number(n || 0).toLocaleString()
const pct = (a, b, digits = 1) => (b > 0 ? `${((a / b) * 100).toFixed(digits).replace(/\.0$/, '')}%` : '—')
const ratio = (a, b) => (b > 0 ? a / b : 0)

function fmtDuration(seconds) {
  const s = Math.round(Number(seconds) || 0)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${String(s % 60).padStart(2, '0')}s`
}

function fmtMinutes(minutes) {
  const m = Math.round(Number(minutes) || 0)
  if (m < 60) return `${m} min`
  if (m < 60 * 48) return `${Math.round(m / 6) / 10} h`
  return `${Math.round(m / 144) / 10} days`
}

const methodLabel = key => METHODS.find(m => m.key === key)?.label || key
const placementLabel = label => CTA_PLACEMENTS[label] || label
// "Hero · WhatsApp": the placement alone is ambiguous where one spot holds two buttons.
const placementWithRoute = label => {
  const route = /_(book|whatsapp|phone|email)$/.exec(label)?.[1]
  return route && CTA_PLACEMENTS[label] ? `${CTA_PLACEMENTS[label]} · ${methodLabel(route)}` : placementLabel(label)
}

function toDateStr(d) {
  return DateTime.fromJSDate(d).toFormat('yyyy-MM-dd')
}

// Turns the range picker state into query bounds. `to` is exclusive for the
// timestamp RPCs; `toDate` is inclusive for the SEO (date) RPC. `prev` is the
// equal-length window just before, for period-over-period deltas.
function resolveRange(range) {
  const now = new Date()
  if (range.preset === 'all') {
    return { from: null, to: null, fromDate: null, toDate: null, prev: null, label: 'All Time' }
  }
  if (range.preset === 'month') {
    const from = new Date(range.month.year, range.month.month, 1)
    const to = new Date(range.month.year, range.month.month + 1, 1)
    const prevFrom = new Date(range.month.year, range.month.month - 1, 1)
    return {
      from, to,
      fromDate: toDateStr(from), toDate: toDateStr(new Date(to.getTime() - 86400000)),
      prev: { from: prevFrom, to: from },
      label: getPeriodLabel({ mode: 'month', ...range.month }),
    }
  }
  const days = PRESETS.find(p => p.key === range.preset)?.days || 30
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const from = new Date(startOfToday.getTime() - (days - 1) * 86400000)
  const to = new Date(startOfToday.getTime() + 86400000)
  return {
    from, to,
    fromDate: toDateStr(from), toDate: toDateStr(startOfToday),
    prev: { from: new Date(from.getTime() - days * 86400000), to: from },
    label: `Last ${days} days`,
  }
}

// Fill gaps and bucket a sparse daily series into at most ~30 bars.
function bucketSeries(points, valueKeys, dateKey = 'day') {
  if (!points || points.length === 0) return []
  const byDay = new Map(points.map(p => [p[dateKey], p]))
  const first = DateTime.fromISO(points[0][dateKey])
  const last = DateTime.fromISO(points[points.length - 1][dateKey])
  const spanDays = Math.max(1, Math.round(last.diff(first, 'days').days) + 1)
  const unit = spanDays > 400 ? 'month' : spanDays > 60 ? 'week' : 'day'

  const buckets = new Map()
  for (let i = 0; i < spanDays; i++) {
    const d = first.plus({ days: i })
    const start = unit === 'month' ? d.startOf('month') : unit === 'week' ? d.startOf('week') : d
    const key = start.toISODate()
    if (!buckets.has(key)) {
      const label = unit === 'month' ? start.toFormat('LLL yy') : start.toFormat('d LLL')
      buckets.set(key, { key, label, ...Object.fromEntries(valueKeys.map(k => [k, 0])) })
    }
    const row = byDay.get(d.toISODate())
    if (row) valueKeys.forEach(k => { buckets.get(key)[k] += Number(row[k]) || 0 })
  }
  return Array.from(buckets.values()).slice(-30)
}

function pctChange(cur, prev) {
  if (prev == null) return null
  if (prev === 0) return cur > 0 ? 100 : 0
  return ((cur - prev) / prev) * 100
}

// ── small presentational pieces ──
function Delta({ cur, prev, invert = false }) {
  const change = pctChange(Number(cur) || 0, prev == null ? null : Number(prev) || 0)
  if (change == null) return null
  const rounded = Math.round(change)
  if (rounded === 0) return <span className="wa-delta wa-delta-flat">no change</span>
  const good = invert ? rounded < 0 : rounded > 0
  return (
    <span className={`wa-delta ${good ? 'wa-delta-up' : 'wa-delta-down'}`} title="vs the previous period">
      {rounded > 0 ? '▲' : '▼'} {Math.abs(rounded)}%
    </span>
  )
}

function Stat({ label, value, sub, delta }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {(sub || delta) && <div className="wa-stat-sub">{delta}{sub && <span>{sub}</span>}</div>}
    </div>
  )
}

function Empty({ children }) {
  return <div className="empty-state"><p className="empty-state-desc">{children}</p></div>
}

function BarList({ rows, valueKey = 'sessions', labelKey = 'name', max, suffix, format = num }) {
  if (!rows || rows.length === 0) return <Empty>No data in this period yet.</Empty>
  const top = max ?? Math.max(...rows.map(r => Number(r[valueKey]) || 0), 1)
  return (
    <div className="wa-barlist">
      {rows.map((r, i) => (
        <div className="wa-barlist-row" key={`${r[labelKey]}-${i}`}>
          <span className="wa-barlist-label" title={r[labelKey]}>{r[labelKey]}</span>
          <div className="wa-barlist-track"><div className="wa-barlist-fill" style={{ width: `${(Number(r[valueKey]) / top) * 100}%` }} /></div>
          <span className="wa-barlist-value">{format(r[valueKey])}{suffix}</span>
        </div>
      ))}
    </div>
  )
}

function TrendChart({ points, series, emptyText = 'No data in this period yet.' }) {
  if (!points || points.length === 0) return <Empty>{emptyText}</Empty>
  const max = Math.max(...points.map(p => Math.max(...series.map(s => p[s.key] || 0))), 1)
  return (
    <>
      <div className="mkt-bar-chart">
        {points.map(p => (
          <div className="mkt-bar-col" key={p.key}>
            <div className="mkt-bar-track">
              {series.map(s => (
                <div key={s.key} className={`mkt-bar-fill ${s.className}`} style={{ height: `${((p[s.key] || 0) / max) * 100}%` }} title={`${p.label}: ${num(p[s.key])} ${s.label}`} />
              ))}
            </div>
            <span className="mkt-bar-label">{points.length > 16 ? '' : p.label}</span>
            <span className="mkt-bar-value">{points.length > 16 ? '' : num(p[series[0].key])}</span>
          </div>
        ))}
      </div>
      <div className="mkt-bar-legend">
        {series.map(s => <span key={s.key} className="mkt-bar-legend-item"><span className={`mkt-bar-legend-dot ${s.dot}`} /> {s.label}</span>)}
        {points.length > 16 && <span className="mkt-bar-legend-item">{points[0].label} – {points[points.length - 1].label}</span>}
      </div>
    </>
  )
}

function Section({ title, hint, children, className = '' }) {
  return (
    <div className={`section-card ${className}`}>
      <div className="section-card-header"><h2 className="section-card-title">{title}</h2></div>
      {hint && <p className="wa-hint">{hint}</p>}
      {children}
    </div>
  )
}

function DataTable({ columns, rows, empty = 'No data in this period yet.' }) {
  if (!rows || rows.length === 0) return <Empty>{empty}</Empty>
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead><tr>{columns.map(c => <th key={c.key} className={c.num ? 'wa-num' : ''}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map(c => (
                <td key={c.key} className={c.num ? 'wa-num' : ''} title={c.title ? c.title(r) : undefined}>
                  {c.render ? c.render(r) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function QuestionCard({ n, question, answer, detail, active, onClick }) {
  return (
    <button type="button" className={`wa-question ${active ? 'active' : ''}`} onClick={onClick}>
      <span className="wa-question-n">{n}</span>
      <span className="wa-question-q">{question}</span>
      <span className="wa-question-a">{answer}</span>
      <span className="wa-question-d">{detail}</span>
    </button>
  )
}

const rate = (a, b) => <span className="wa-rate">{pct(a, b)}</span>

// Where one lead got to. `booked` is absent until the booking-journey migration
// has run; then the status falls back to the lead's score alone.
function JourneyStatus({ r }) {
  let text = r.is_disqualified ? 'flagged' : r.classification
  let tone = r.qualified ? 'wa-chip-ok' : r.is_disqualified ? 'wa-chip-warn' : ''
  if (r.booked === false) { text = 'details only'; tone = 'wa-chip-warn' }
  else if (r.booked === true && !r.prep_done) { text = 'booked'; tone = '' }
  return (
    <>
      <span className={`wa-chip ${tone}`}>{text}</span>
      {r.after_reminder && <span className="wa-muted"> after reminder</span>}
    </>
  )
}

// ────────────────────────────────────────────────────────────────────────────
export default function WebsiteAnalytics() {
  const nowD = new Date()
  const [range, setRange] = useState({ preset: '30d', month: { month: nowD.getMonth(), year: nowD.getFullYear() } })
  const [tab, setTab] = useState('acquisition')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tz, setTz] = useState(DEFAULT_TZ)
  const [data, setData] = useState({ acq: null, beh: null, conv: null, seo: null, prevAcq: null, prevConv: null, seoError: null })
  const [showInstall, setShowInstall] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [toast, setToast] = useState({ show: false, type: '', text: '' })
  const requestRef = useRef(0)

  const resolved = useMemo(() => resolveRange(range), [range])

  useEffect(() => {
    supabase.from('system_settings').select('key, value').eq('key', 'team_timezone').maybeSingle()
      .then(({ data: row }) => { if (row?.value) setTz(row.value) })
  }, [])

  useEffect(() => { load() }, [resolved, tz])

  useEffect(() => {
    if (!toast.show) return
    const t = setTimeout(() => setToast({ show: false, type: '', text: '' }), 5000)
    return () => clearTimeout(t)
  }, [toast.show])

  function showToast(type, text) { setToast({ show: true, type, text }) }

  async function load() {
    const requestId = ++requestRef.current
    setLoading(true)
    setError(null)

    const bounds = r => ({ p_from: r.from ? r.from.toISOString() : null, p_to: r.to ? r.to.toISOString() : null, p_tz: tz })
    const rpc = (fn, args) => supabase.rpc(fn, args)
    const calls = [
      rpc('web_analytics_acquisition', bounds(resolved)),
      rpc('web_analytics_behavior', bounds(resolved)),
      rpc('web_analytics_conversion', bounds(resolved)),
      rpc('seo_overview', { p_from: resolved.fromDate, p_to: resolved.toDate }),
    ]
    if (resolved.prev) {
      calls.push(rpc('web_analytics_acquisition', bounds(resolved.prev)))
      calls.push(rpc('web_analytics_conversion', bounds(resolved.prev)))
    }
    const [acq, beh, conv, seo, prevAcq, prevConv] = await Promise.all(calls)

    if (requestId !== requestRef.current) return // a newer range was picked meanwhile

    const fatal = [acq, beh, conv].find(r => r.error)
    if (fatal) {
      const missing = fatal.error.code === 'PGRST202' || /could not find the function/i.test(fatal.error.message || '')
      setError(missing
        ? 'Website analytics is not set up yet. Run supabase/migration-website-analytics.sql in the Supabase SQL Editor, then reload.'
        : `Could not load website analytics: ${fatal.error.message}`)
      setLoading(false)
      return
    }

    setData({
      acq: acq.data, beh: beh.data, conv: conv.data,
      seo: seo.error ? null : seo.data,
      seoError: seo.error ? seo.error.message : null,
      prevAcq: prevAcq && !prevAcq.error ? prevAcq.data : null,
      prevConv: prevConv && !prevConv.error ? prevConv.data : null,
    })
    setLoading(false)
  }

  async function syncSearchConsole() {
    setSyncing(true)
    try {
      const { data: res, error: fnError } = await supabase.functions.invoke('sm-gsc-sync', { body: {} })
      if (fnError) throw new Error('Could not reach the sync function. Is sm-gsc-sync deployed?')
      if (!res?.success) throw new Error(res?.error || 'Sync failed')
      showToast('success', res.skipped ? 'Already synced a moment ago' : `Search Console synced (${num(res.rows?.queries)} query rows)`)
      load()
    } catch (err) {
      showToast('error', err.message)
    } finally {
      setSyncing(false)
    }
  }

  // ── derived ──
  const { acq, beh, conv, seo, prevAcq, prevConv } = data

  const sessions = acq?.kpis?.sessions || 0
  const leads = acq?.kpis?.leads || 0
  const qualified = acq?.kpis?.qualified || 0
  const topChannel = acq?.channels?.[0]

  const acqTrend = useMemo(() => bucketSeries(acq?.trend, ['sessions', 'leads']), [acq])
  const behTrend = useMemo(() => bucketSeries(beh?.trend, ['pageviews']), [beh])
  const seoTrend = useMemo(() => bucketSeries(seo?.daily?.map(d => ({ ...d, day: d.date })), ['clicks', 'impressions']), [seo])

  const funnel = conv?.funnel
  const funnelRows = useMemo(() => {
    if (!funnel) return []
    const rows = FUNNEL_STEPS.map(s => ({ ...s, count: funnel[s.key] || 0 }))
    let worst = -1
    let worstDrop = 0
    rows.forEach((r, i) => {
      const prev = i > 0 ? rows[i - 1].count : null
      r.stepRate = prev ? r.count / prev : null
      r.drop = prev ? prev - r.count : 0
      // The first step (all sessions -> opened the form) is mostly people who
      // were never going to book, so the "biggest leak" callout starts after it.
      // Only the steps up to booking count: the prep questions are optional, so a drop there is expected.
      if (i >= 2 && r.key !== 'prep_done' && r.key !== 'qualified' && prev > 0 && r.drop / prev > worstDrop) { worstDrop = r.drop / prev; worst = i }
    })
    if (worst >= 0 && worstDrop > 0) rows[worst].worst = true
    return rows
  }, [funnel])

  const answersByQuestion = useMemo(() => {
    const out = {}
    Object.entries(QUALIFICATION_QUESTIONS).forEach(([q, def]) => {
      const counts = Object.fromEntries((conv?.answers || []).filter(a => a.q === q).map(a => [a.value, a.sessions]))
      const total = Object.values(counts).reduce((s, n) => s + n, 0)
      out[q] = {
        question: def.question,
        total,
        options: def.options.map(o => ({ name: o.label, sessions: counts[o.value] || 0, disqualifier: !!o.disqualifier })),
      }
    })
    return out
  }, [conv])

  // The booking-journey sections need migration-website-analytics-booking-journey.sql.
  // Until it has run the keys are simply absent, so those sections stay hidden.
  const journeyReady = !!conv && conv.follow_up !== undefined
  const followUp = conv?.follow_up
  const afterBooking = conv?.after_booking
  const reach = conv?.contact_reach
  const methodRows = useMemo(() => METHODS.map(m => {
    const r = (conv?.contact_methods || []).find(x => x.method === m.key)
    return { method: m.key, name: m.label, clicks: r?.clicks || 0, sessions: r?.sessions || 0, booked: r?.booked || 0 }
  }), [conv])
  const errorRows = useMemo(() => (conv?.errors_by_stage || []).map(r => ({ ...r, name: ERROR_STAGES[r.stage] || r.stage })), [conv])

  const allEmpty = !loading && !error && sessions === 0 && (beh?.kpis?.pageviews || 0) === 0 && (conv?.coverage?.leads_total || 0) === 0

  // ── export ──
  function handleExportCSV() {
    const headers = ['Metric', 'Value']
    const rows = [
      ['Period', resolved.label],
      ['Sessions', String(sessions)],
      ['Visitors', String(acq?.kpis?.visitors || 0)],
      ['Pageviews', String(beh?.kpis?.pageviews || 0)],
      ['Avg engaged seconds', String(beh?.kpis?.avg_engaged_seconds || 0)],
      ['Bounce rate %', String(beh?.kpis?.bounce_rate || 0)],
      ['Leads', String(leads)],
      ['Qualified leads', String(qualified)],
      ['Session to lead rate', pct(leads, sessions)],
      [''],
      ['Channel', 'Sessions', 'Leads', 'Qualified'],
      ...(acq?.channels || []).map(c => [c.channel, String(c.sessions), String(c.leads), String(c.qualified)]),
      [''],
      ['Source', 'Medium', 'Sessions', 'Leads', 'Qualified'],
      ...(acq?.sources || []).map(s => [s.source, s.medium || '', String(s.sessions), String(s.leads), String(s.qualified)]),
      [''],
      ['Campaign', 'Sessions', 'Leads', 'Qualified'],
      ...(acq?.campaigns || []).map(c => [c.campaign, String(c.sessions), String(c.leads), String(c.qualified)]),
      [''],
      ['Booking funnel step', 'Visits'],
      ...funnelRows.map(r => [r.label, String(r.count)]),
      [''],
      ...(journeyReady ? [
        ['Contact route', 'Visits', 'Clicks', 'Booked a call'],
        ...methodRows.map(m => [m.name, String(m.sessions), String(m.clicks), String(m.booked)]),
        ['Visits that went off-site and did not book', String(reach?.offsite_not_booked || 0)],
        [''],
        ['Call-to-action placement', 'Route', 'Clicks', 'Visits', 'Booked'],
        ...(conv?.cta_placements || []).map(p => [placementLabel(p.label), methodLabel(p.method), String(p.clicks), String(p.sessions), String(p.booked)]),
        [''],
        ['Follow-up', 'Count'],
        ['Waiting for a time', String(followUp?.waiting || 0)],
        ['Reminded', String(followUp?.reminded || 0)],
        ['Booked after reminder', String(followUp?.recovered || 0)],
        ['Returning visits', String(followUp?.returns || 0)],
        [''],
        ['After booking', 'Count'],
        ['Booked', String(afterBooking?.booked || 0)],
        ['Added to calendar', String(afterBooking?.calendar_added || 0)],
        ['Shown prep questions', String(afterBooking?.prep_shown || 0)],
        ['Skipped prep questions', String(afterBooking?.prep_skipped || 0)],
        ['Answered prep questions', String(afterBooking?.prep_answered || 0)],
        [''],
        ['Booking page problem', 'Visits'],
        ...errorRows.map(e => [e.name, String(e.sessions)]),
        [''],
      ] : []),
      ['Page', 'Views', 'Avg engaged (s)', 'Avg scroll %'],
      ...(beh?.top_pages || []).map(p => [`${p.host || ''}${p.path}`, String(p.views), String(p.avg_engaged_seconds ?? ''), String(p.avg_scroll ?? '')]),
      [''],
      ['Search query', 'Clicks', 'Impressions', 'CTR', 'Avg position'],
      ...(seo?.queries || []).map(q => [q.query, String(q.clicks), String(q.impressions), `${(q.ctr * 100).toFixed(1)}%`, String(q.position ?? '')]),
    ]
    exportCSV(headers, rows, `SDFM_Website_Analytics_${new Date().toISOString().slice(0, 10)}`)
  }

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(getTrackerSnippet())
      showToast('success', 'Snippet copied')
    } catch {
      showToast('error', 'Could not copy — select the text and copy it manually')
    }
  }

  // ── render ──
  const header = (
    <div className="page-header dash-header">
      <div>
        <h1 className="page-title">Website Analytics</h1>
        <p className="page-subtitle">How people find us, what they do on the site, and whether they become qualified leads · {resolved.label}</p>
      </div>
      <div className="dash-header-actions">
        <div className="wa-presets" role="group" aria-label="Date range">
          {PRESETS.map(p => (
            <button key={p.key} type="button" className={`wa-preset ${range.preset === p.key ? 'active' : ''}`} onClick={() => setRange(r => ({ ...r, preset: p.key }))}>{p.label}</button>
          ))}
        </div>
        {range.preset === 'month' && (
          <PeriodSelector
            value={{ mode: 'month', ...range.month }}
            onChange={v => setRange(r => ({ ...r, month: { month: v.month, year: v.year }, preset: v.mode === 'all' ? 'all' : 'month' }))}
          />
        )}
        <button className="btn btn-secondary btn-sm" onClick={() => setShowInstall(true)}>Install tracker</button>
        {!loading && !error && sessions > 0 && <button className="btn btn-secondary btn-sm" onClick={handleExportCSV}>CSV</button>}
      </div>
    </div>
  )

  if (error) {
    return (
      <div>
        {header}
        <div className="section-card"><Empty>{error}</Empty></div>
      </div>
    )
  }

  if (loading && !acq) {
    return (
      <div>
        {header}
        <div className="dash-stats-row">{[1, 2, 3, 4].map(i => <div key={i} className="skeleton skeleton-card" />)}</div>
        <div className="skeleton skeleton-card" style={{ height: 200 }} />
      </div>
    )
  }

  const bounceRate = beh?.kpis?.bounce_rate || 0

  return (
    <div className={loading ? 'wa-loading' : ''}>
      {header}

      {allEmpty && (
        <div className="section-card wa-onboarding">
          <h2 className="section-card-title">No website activity recorded yet</h2>
          <p className="wa-hint">
            The booking page (sdfmgroup.com/book) is tracked by the same snippet as the rest of sdfmgroup.com. Add the tracker snippet to the website to see how visitors find, browse and book.
          </p>
          <button className="btn btn-primary btn-sm" onClick={() => setShowInstall(true)}>Show install snippet</button>
        </div>
      )}

      {/* ── The three questions ── */}
      <div className="wa-questions">
        <QuestionCard
          n="1" question="How are people finding us?" active={tab === 'acquisition' || tab === 'seo'}
          answer={topChannel ? `${topChannel.channel} · ${pct(topChannel.sessions, sessions, 0)}` : 'No visits yet'}
          detail={`${num(sessions)} sessions${seo?.totals?.clicks ? ` · ${num(seo.totals.clicks)} search clicks` : ''}`}
          onClick={() => setTab('acquisition')}
        />
        <QuestionCard
          n="2" question="What are they doing on the website?" active={tab === 'behavior'}
          answer={sessions ? `${fmtDuration(beh?.kpis?.avg_engaged_seconds)} engaged · ${beh?.kpis?.pages_per_session || 0} pages per visit` : 'No visits yet'}
          detail={`${bounceRate}% bounce · ${num(beh?.kpis?.pageviews)} pageviews`}
          onClick={() => setTab('behavior')}
        />
        <QuestionCard
          n="3" question="Are they becoming qualified leads?" active={tab === 'conversion'}
          answer={`${num(qualified)} qualified of ${num(leads)} lead${leads === 1 ? '' : 's'}`}
          detail={`${pct(leads, sessions)} of visits become leads · ${pct(qualified, sessions)} qualified`}
          onClick={() => setTab('conversion')}
        />
      </div>

      <div className="wa-tabs" role="tablist">
        {TABS.map(t => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} type="button" className={`wa-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {/* ═════════════ ACQUISITION ═════════════ */}
      {tab === 'acquisition' && (
        <>
          <div className="dash-stats-row">
            <Stat label="Sessions" value={num(sessions)} delta={<Delta cur={sessions} prev={prevAcq?.kpis?.sessions} />} />
            <Stat label="Visitors" value={num(acq?.kpis?.visitors)} delta={<Delta cur={acq?.kpis?.visitors} prev={prevAcq?.kpis?.visitors} />} sub={acq?.kpis?.returning_sessions ? `${num(acq.kpis.returning_sessions)} returning` : undefined} />
            <Stat label="Leads" value={num(leads)} delta={<Delta cur={leads} prev={prevAcq?.kpis?.leads} />} />
            <Stat label="Qualified leads" value={num(qualified)} delta={<Delta cur={qualified} prev={prevAcq?.kpis?.qualified} />} />
          </div>

          <div className="dash-grid-2">
            <Section title="Sessions over time">
              <TrendChart points={acqTrend} series={[
                { key: 'sessions', label: 'Sessions', className: 'mkt-bar-total', dot: 'total' },
                { key: 'leads', label: 'Leads', className: 'mkt-bar-qualified', dot: 'qualified' },
              ]} />
            </Section>
            <Section title="Traffic channels" hint="Where each visit came from, by its first touch. Leads and qualified leads are credited to the channel that first brought the visitor.">
              <DataTable
                rows={acq?.channels}
                columns={[
                  { key: 'channel', label: 'Channel' },
                  { key: 'sessions', label: 'Sessions', num: true, render: r => <>{num(r.sessions)} <span className="wa-muted">{pct(r.sessions, sessions, 0)}</span></> },
                  { key: 'leads', label: 'Leads', num: true, render: r => num(r.leads) },
                  { key: 'qualified', label: 'Qualified', num: true, render: r => num(r.qualified) },
                  { key: 'rate', label: 'Visit → lead', num: true, render: r => rate(r.leads, r.sessions) },
                ]}
              />
            </Section>
          </div>

          <div className="dash-grid-2">
            <Section title="Top sources">
              <DataTable
                rows={acq?.sources}
                columns={[
                  { key: 'source', label: 'Source', render: r => <>{r.source}{r.medium ? <span className="wa-muted"> / {r.medium}</span> : null}</> },
                  { key: 'sessions', label: 'Sessions', num: true, render: r => num(r.sessions) },
                  { key: 'leads', label: 'Leads', num: true, render: r => num(r.leads) },
                  { key: 'qualified', label: 'Qualified', num: true, render: r => num(r.qualified) },
                ]}
              />
            </Section>
            <Section title="Campaigns" hint="From utm_campaign. Posts composed in the Social Media module tag their links automatically.">
              <DataTable
                rows={acq?.campaigns}
                empty="No tagged campaign traffic in this period."
                columns={[
                  { key: 'campaign', label: 'Campaign' },
                  { key: 'sessions', label: 'Sessions', num: true, render: r => num(r.sessions) },
                  { key: 'leads', label: 'Leads', num: true, render: r => num(r.leads) },
                  { key: 'qualified', label: 'Qualified', num: true, render: r => num(r.qualified) },
                ]}
              />
            </Section>
          </div>

          <Section title="Referring sites">
            <DataTable
              rows={acq?.referrers}
              empty="No referral traffic in this period."
              columns={[
                { key: 'domain', label: 'Domain' },
                { key: 'channel', label: 'Channel' },
                { key: 'sessions', label: 'Sessions', num: true, render: r => num(r.sessions) },
                { key: 'leads', label: 'Leads', num: true, render: r => num(r.leads) },
              ]}
            />
          </Section>
        </>
      )}

      {/* ═════════════ SEO ═════════════ */}
      {tab === 'seo' && (
        <>
          <div className="wa-seo-status">
            <span>
              {seo?.status?.gsc_site_url
                ? <>Property <strong>{seo.status.gsc_site_url}</strong>{seo.totals?.last_date ? <> · data through {seo.totals.last_date}</> : null}{seo.status.gsc_last_sync_at ? <> · synced {DateTime.fromISO(seo.status.gsc_last_sync_at).toRelative()}</> : null}</>
                : 'Google Search Console is not connected yet.'}
              {seo?.status?.gsc_last_sync_status && seo.status.gsc_last_sync_status !== 'ok' && (
                <span className="wa-sync-error"> · {seo.status.gsc_last_sync_status}</span>
              )}
            </span>
            <button className="btn btn-secondary btn-sm" onClick={syncSearchConsole} disabled={syncing}>{syncing ? 'Syncing…' : 'Sync now'}</button>
          </div>

          {data.seoError ? (
            <div className="section-card"><Empty>Could not load search data: {data.seoError}. Run migration-website-analytics.sql if you have not yet.</Empty></div>
          ) : !seo?.totals?.first_date ? (
            <div className="section-card wa-onboarding">
              <h2 className="section-card-title">Connect Google Search Console</h2>
              <ol className="wa-steps">
                <li>In Google Cloud, enable the <strong>Search Console API</strong> and create a <strong>service account</strong> with a JSON key.</li>
                <li>In Search Console → Settings → Users and permissions, add the service account's email as a user (Restricted is enough).</li>
                <li>Set the key as the Supabase secret <code>GSC_SERVICE_ACCOUNT_JSON</code> and deploy <code>sm-gsc-sync</code>.</li>
                <li>An admin enters the property in <strong>Settings → Search Console</strong>, then press <em>Sync now</em>.</li>
              </ol>
              <p className="wa-hint">Full instructions are in the README under “Website Analytics”. The first sync backfills 90 days.</p>
            </div>
          ) : (
            <>
              <div className="dash-stats-row">
                <Stat label="Search clicks" value={num(seo.totals.clicks)} />
                <Stat label="Impressions" value={num(seo.totals.impressions)} />
                <Stat label="Click-through rate" value={`${(seo.totals.ctr * 100).toFixed(1)}%`} />
                <Stat label="Avg. position" value={seo.totals.position ?? '—'} sub="lower is better" />
              </div>

              <div className="dash-grid-2">
                <Section title="Search clicks over time">
                  <TrendChart points={seoTrend} series={[{ key: 'clicks', label: 'Clicks', className: 'mkt-bar-qualified', dot: 'qualified' }]} />
                </Section>
                <Section title="Opportunities" hint="Queries where we already rank on page 1–2 (position 5–20) with real impressions. The cheapest SEO wins: better titles, snippets and content for these.">
                  <DataTable
                    rows={seo.opportunities}
                    empty="Nothing in striking distance yet."
                    columns={[
                      { key: 'query', label: 'Query' },
                      { key: 'impressions', label: 'Impr.', num: true, render: r => num(r.impressions) },
                      { key: 'position', label: 'Pos.', num: true, render: r => r.position },
                      { key: 'ctr', label: 'CTR', num: true, render: r => `${(r.ctr * 100).toFixed(1)}%` },
                    ]}
                  />
                </Section>
              </div>

              <Section title="Top search queries" hint="Google hides very rare queries for privacy, so these rows add up to a little less than the totals above.">
                <DataTable
                  rows={seo.queries}
                  columns={[
                    { key: 'query', label: 'Query' },
                    { key: 'clicks', label: 'Clicks', num: true, render: r => num(r.clicks) },
                    { key: 'impressions', label: 'Impressions', num: true, render: r => num(r.impressions) },
                    { key: 'ctr', label: 'CTR', num: true, render: r => `${(r.ctr * 100).toFixed(1)}%` },
                    { key: 'position', label: 'Avg. position', num: true, render: r => r.position },
                  ]}
                />
              </Section>

              <Section title="Search pages → leads" hint="Search impressions and clicks from Google, joined to our own tracking: how many organic visits landed on each page and how many became a lead.">
                <DataTable
                  rows={seo.pages}
                  columns={[
                    { key: 'path', label: 'Page', title: r => r.page },
                    { key: 'clicks', label: 'Search clicks', num: true, render: r => num(r.clicks) },
                    { key: 'impressions', label: 'Impressions', num: true, render: r => num(r.impressions) },
                    { key: 'position', label: 'Pos.', num: true, render: r => r.position },
                    { key: 'organic_sessions', label: 'Organic visits', num: true, render: r => num(r.organic_sessions) },
                    { key: 'organic_leads', label: 'Leads', num: true, render: r => num(r.organic_leads) },
                  ]}
                />
              </Section>

              <div className="dash-grid-2">
                <Section title="Countries"><BarList rows={seo.countries} valueKey="clicks" format={num} suffix=" clicks" /></Section>
                <Section title="Devices"><BarList rows={seo.devices} valueKey="clicks" format={num} suffix=" clicks" /></Section>
              </div>
            </>
          )}
        </>
      )}

      {/* ═════════════ BEHAVIOR ═════════════ */}
      {tab === 'behavior' && (
        <>
          <div className="dash-stats-row">
            <Stat label="Pageviews" value={num(beh?.kpis?.pageviews)} />
            <Stat label="Avg. time engaged" value={fmtDuration(beh?.kpis?.avg_engaged_seconds)} sub="per session" />
            <Stat label="Pages / session" value={beh?.kpis?.pages_per_session || 0} />
            <Stat label="Bounce rate" value={`${bounceRate}%`} sub="lower is better" />
          </div>

          <div className="dash-grid-2">
            <Section title="Pageviews over time">
              <TrendChart points={behTrend} series={[{ key: 'pageviews', label: 'Pageviews', className: 'mkt-bar-total', dot: 'total' }]} />
            </Section>
            <Section title="What people click" hint="Link and button labels only — nothing typed into a form is ever recorded.">
              <DataTable
                rows={beh?.clicks}
                empty="No clicks recorded in this period."
                columns={[
                  { key: 'label', label: 'Label', title: r => r.label, render: r => placementWithRoute(r.label) },
                  { key: 'type', label: 'Type', render: r => <span className="wa-chip">{r.type.replace('_', ' ')}</span> },
                  { key: 'clicks', label: 'Clicks', num: true, render: r => num(r.clicks) },
                ]}
              />
            </Section>
          </div>

          <Section title="Top pages">
            <DataTable
              rows={beh?.top_pages}
              columns={[
                { key: 'path', label: 'Page', render: r => <><span>{r.path}</span><span className="wa-muted"> {r.host}</span></> },
                { key: 'views', label: 'Views', num: true, render: r => num(r.views) },
                { key: 'sessions', label: 'Visitors', num: true, render: r => num(r.sessions) },
                { key: 'avg_engaged_seconds', label: 'Avg. time', num: true, render: r => fmtDuration(r.avg_engaged_seconds) },
                { key: 'avg_scroll', label: 'Avg. scroll', num: true, render: r => (r.avg_scroll != null ? `${r.avg_scroll}%` : '—') },
              ]}
            />
          </Section>

          <Section title="Landing pages" hint="The first page of each visit — and how well it holds attention and converts.">
            <DataTable
              rows={beh?.landing_pages}
              columns={[
                { key: 'path', label: 'Landing page' },
                { key: 'sessions', label: 'Sessions', num: true, render: r => num(r.sessions) },
                { key: 'bounce_rate', label: 'Bounce', num: true, render: r => `${r.bounce_rate}%` },
                { key: 'avg_engaged_seconds', label: 'Avg. time', num: true, render: r => fmtDuration(r.avg_engaged_seconds) },
                { key: 'leads', label: 'Leads', num: true, render: r => num(r.leads) },
                { key: 'qualified', label: 'Qualified', num: true, render: r => num(r.qualified) },
              ]}
            />
          </Section>

          <div className="dash-grid-2">
            <Section title="Devices"><BarList rows={beh?.devices} /></Section>
            <Section title="Browsers"><BarList rows={beh?.browsers} /></Section>
          </div>
          <div className="dash-grid-2">
            <Section title="Operating systems"><BarList rows={beh?.systems} /></Section>
            <Section title="Visitor regions" hint="Approximate, from the visitor's browser time zone. No IP address or precise location is stored.">
              <BarList rows={beh?.timezones} />
            </Section>
          </div>
          <Section title="Returning visitors" hint="Only visitors who accepted cookies can be recognised on a later visit; everyone else is counted once per session.">
            <div className="sa-attribution-grid">
              <div><span className="sa-attr-value">{num(beh?.visitor_mix?.new)}</span><span className="sa-attr-label">New sessions</span></div>
              <div><span className="sa-attr-value">{num(beh?.visitor_mix?.returning)}</span><span className="sa-attr-label">Returning</span></div>
              <div><span className="sa-attr-value">{pct(beh?.visitor_mix?.consented, sessions, 0)}</span><span className="sa-attr-label">Accepted cookies</span></div>
            </div>
          </Section>
        </>
      )}

      {/* ═════════════ CONVERSION ═════════════ */}
      {tab === 'conversion' && (
        <>
          <div className="dash-stats-row">
            <Stat label="Details saved" value={num(leads)} delta={<Delta cur={leads} prev={prevAcq?.kpis?.leads} />} sub={`${pct(leads, sessions)} of sessions`} />
            <Stat label="Calls booked" value={num(funnel?.submitted)} delta={<Delta cur={funnel?.submitted} prev={prevConv?.funnel?.submitted} />} sub={`${pct(funnel?.submitted, leads, 0)} of details saved`} />
            <Stat label="Qualified leads" value={num(qualified)} delta={<Delta cur={qualified} prev={prevAcq?.kpis?.qualified} />} sub={`${pct(qualified, funnel?.submitted, 0)} of booked`} />
            <Stat
              label="Typical time to book"
              value={conv?.timing?.median_minutes_to_book != null ? fmtMinutes(conv.timing.median_minutes_to_book) : '—'}
              sub={conv?.timing?.avg_pages_before_convert ? `${conv.timing.avg_pages_before_convert} pages first · from first visit` : undefined}
            />
          </div>

          {conv && !journeyReady && (
            <div className="wa-note">
              Run <code>supabase/migration-website-analytics-booking-journey.sql</code> in the Supabase SQL Editor to unlock reminder follow-up, contact routes, after-booking and error reporting. Until then, a lead who returns through the reminder email is counted twice.
            </div>
          )}

          {conv?.coverage?.leads_total > 0 && conv.coverage.leads_tracked < conv.coverage.leads_total && (
            <div className="wa-note">
              {num(conv.coverage.leads_tracked)} of {num(conv.coverage.leads_total)} leads in this period have website attribution. The rest arrived before tracking started, or from visitors whose browser blocked the tracker.
            </div>
          )}

          <Section title="Booking funnel" hint="Each step counts fresh visits that reached it; people coming back through a reminder or prep link are not counted again. Contact details, booking and prep answers come from the leads table, so they cannot be inflated. The red marker shows where the most people are lost on the way to a booked call.">
            <div className="wa-funnel">
              {funnelRows.map((r, i) => (
                <div className={`wa-funnel-row ${r.worst ? 'worst' : ''}`} key={r.key}>
                  <span className="wa-funnel-label">{r.label}</span>
                  <div className="wa-funnel-track"><div className="wa-funnel-fill" style={{ width: `${funnelRows[0].count ? Math.max((r.count / funnelRows[0].count) * 100, r.count ? 1 : 0) : 0}%` }} /></div>
                  <span className="wa-funnel-count">{num(r.count)}</span>
                  <span className="wa-funnel-rate">
                    {/* Over 100% happens at the last step: a lead can be scored from partial prep answers. */}
                    {i === 0 || r.stepRate == null || r.stepRate > 1 ? '' : `${Math.round(r.stepRate * 100)}% continue`}
                    {r.worst && <strong className="wa-funnel-flag"> · biggest drop</strong>}
                  </span>
                </div>
              ))}
            </div>
          </Section>

          <div className="dash-grid-2">
            <Section title="Booking page steps" hint="Where visitors spend time. Counts every visit to the page, so someone returning from a reminder email shows again at “Pick a time”.">
              <DataTable
                rows={conv?.steps?.map(s => ({ ...s, name: STEP_LABELS[s.step] || `Step ${s.step}` }))}
                empty="No booking page activity in this period."
                columns={[
                  { key: 'name', label: 'Step' },
                  { key: 'views', label: 'Reached', num: true, render: r => num(r.views) },
                  { key: 'completes', label: 'Continued', num: true, render: r => (r.step === '3' ? '—' : num(r.completes)) },
                  { key: 'avg_seconds', label: 'Avg. time', num: true, render: r => (r.avg_seconds != null ? fmtDuration(r.avg_seconds) : '—') },
                ]}
              />
              {errorRows.length > 0 ? (
                <>
                  <p className="wa-hint" style={{ margin: 'var(--space-md) 0 var(--space-sm)' }}>When something went wrong or was blocked</p>
                  <DataTable
                    rows={errorRows}
                    columns={[
                      { key: 'name', label: 'What happened' },
                      { key: 'sessions', label: 'Visits', num: true, render: r => num(r.sessions) },
                    ]}
                  />
                </>
              ) : conv?.errors > 0 && (
                <p className="wa-hint" style={{ marginTop: 'var(--space-sm)' }}>
                  {num(conv.errors)} submission error{conv.errors === 1 ? '' : 's'}
                </p>
              )}
            </Section>
            <Section title="Conversion by channel">
              <DataTable
                rows={conv?.by_channel}
                columns={[
                  { key: 'channel', label: 'Channel' },
                  { key: 'sessions', label: 'Sessions', num: true, render: r => num(r.sessions) },
                  { key: 'form_views', label: 'Opened form', num: true, render: r => num(r.form_views) },
                  { key: 'leads', label: 'Details saved', num: true, render: r => num(r.leads) },
                  ...(journeyReady ? [{ key: 'booked', label: 'Booked', num: true, render: r => num(r.booked) }] : []),
                  { key: 'qualified', label: 'Qualified', num: true, render: r => num(r.qualified) },
                  { key: 'rate', label: 'Visit → qualified', num: true, render: r => rate(r.qualified, r.sessions) },
                ]}
              />
            </Section>
          </div>

          {journeyReady && (
            <>
              <div className="dash-grid-2">
                <Section title="Reminder follow-up" hint="People who saved their details but have not picked a time get one reminder email about 30 minutes later. “Booked after reminder” counts leads whose booking came after that email went out.">
                  <div className="sa-attribution-grid">
                    <div><span className="sa-attr-value">{num(followUp?.waiting)}</span><span className="sa-attr-label">Waiting for a time</span></div>
                    <div><span className="sa-attr-value">{num(followUp?.reminded)}</span><span className="sa-attr-label">Reminded</span></div>
                    <div>
                      <span className="sa-attr-value">{num(followUp?.recovered)}</span>
                      <span className="sa-attr-label">Booked after reminder{followUp?.reminded > 0 ? ` · ${pct(followUp.recovered, followUp.reminded, 0)}` : ''}</span>
                    </div>
                    <div><span className="sa-attr-value">{num(followUp?.returns)}</span><span className="sa-attr-label">Returning visits</span></div>
                  </div>
                </Section>
                <Section title="After booking" hint="What people do on the confirmation screen. Prep answers also arrive later through the emailed link, so “answered” can be higher than “shown”.">
                  <div className="sa-attribution-grid">
                    <div><span className="sa-attr-value">{pct(afterBooking?.calendar_added, afterBooking?.booked, 0)}</span><span className="sa-attr-label">Added to calendar</span></div>
                    <div><span className="sa-attr-value">{num(afterBooking?.prep_shown)}</span><span className="sa-attr-label">Shown prep questions</span></div>
                    <div><span className="sa-attr-value">{num(afterBooking?.prep_skipped)}</span><span className="sa-attr-label">Skipped them</span></div>
                    <div>
                      <span className="sa-attr-value">{pct(afterBooking?.prep_answered, afterBooking?.booked, 0)}</span>
                      <span className="sa-attr-label">Answered{afterBooking?.avg_questions > 0 ? ` · ${afterBooking.avg_questions} of 5 on average` : ''}</span>
                    </div>
                  </div>
                </Section>
              </div>

              <div className="dash-grid-2">
                <Section title="How visitors choose to get in touch" hint="Which route each visit took from the call-to-action buttons. WhatsApp, phone and email happen outside the site, so those never appear in the funnel above.">
                  <DataTable
                    rows={methodRows}
                    columns={[
                      { key: 'name', label: 'Route' },
                      { key: 'sessions', label: 'Visits', num: true, render: r => num(r.sessions) },
                      { key: 'clicks', label: 'Clicks', num: true, render: r => num(r.clicks) },
                      { key: 'booked', label: 'Booked a call', num: true, render: r => num(r.booked) },
                    ]}
                  />
                  {reach?.offsite_not_booked > 0 && (
                    <div className="wa-note" style={{ marginTop: 'var(--space-md)' }}>
                      {num(reach.offsite_not_booked)} visit{reach.offsite_not_booked === 1 ? '' : 's'} went to WhatsApp, phone or email and did not book on the site. Those conversations are not in the CRM: check the WhatsApp inbox and call log.
                    </div>
                  )}
                </Section>
                <Section title="Call-to-action placements" hint="Every button that leads to the booking page, WhatsApp, phone or email, by where it sits. “Booked” counts visits that clicked it and later booked a call.">
                  <DataTable
                    rows={conv?.cta_placements}
                    empty="No call-to-action clicks in this period."
                    columns={[
                      { key: 'label', label: 'Placement', title: r => r.label, render: r => placementLabel(r.label) },
                      { key: 'method', label: 'Route', render: r => <span className="wa-chip">{methodLabel(r.method)}</span> },
                      { key: 'clicks', label: 'Clicks', num: true, render: r => num(r.clicks) },
                      { key: 'booked', label: 'Booked', num: true, render: r => num(r.booked) },
                    ]}
                  />
                </Section>
              </div>
            </>
          )}

          <div className="dash-grid-2">
            <Section title="Pages that start conversions" hint="Landing pages ranked by the leads they produced.">
              <DataTable
                rows={conv?.by_landing}
                columns={[
                  { key: 'path', label: 'Landing page' },
                  { key: 'sessions', label: 'Sessions', num: true, render: r => num(r.sessions) },
                  { key: 'leads', label: 'Leads', num: true, render: r => num(r.leads) },
                  { key: 'qualified', label: 'Qualified', num: true, render: r => num(r.qualified) },
                  { key: 'rate', label: 'Visit → lead', num: true, render: r => rate(r.leads, r.sessions) },
                ]}
              />
            </Section>
            <Section title="Campaign conversion">
              <DataTable
                rows={conv?.by_campaign}
                empty="No tagged campaign traffic in this period."
                columns={[
                  { key: 'campaign', label: 'Campaign' },
                  { key: 'sessions', label: 'Sessions', num: true, render: r => num(r.sessions) },
                  { key: 'leads', label: 'Leads', num: true, render: r => num(r.leads) },
                  { key: 'qualified', label: 'Qualified', num: true, render: r => num(r.qualified) },
                ]}
              />
            </Section>
          </div>

          <Section title="Who answers what" hint="The option each visitor settled on (their last choice) for every prep question, asked after a call is booked. Options marked “flagged” never block a booking, but a large share there means the wrong audience is reaching the page.">
            <div className="wa-answers">
              {Object.entries(answersByQuestion).map(([q, a]) => (
                <div className="wa-answer-block" key={q}>
                  <div className="wa-answer-q"><span className="wa-question-n">{q.toUpperCase()}</span>{a.question}<span className="wa-muted"> · {num(a.total)} answered</span></div>
                  <div className="wa-barlist">
                    {a.options.map(o => (
                      <div className="wa-barlist-row" key={o.name}>
                        <span className="wa-barlist-label wa-wide" title={o.name}>{o.name}{o.disqualifier && <span className="wa-chip wa-chip-warn">flagged</span>}</span>
                        <div className="wa-barlist-track"><div className={`wa-barlist-fill ${o.disqualifier ? 'warn' : ''}`} style={{ width: `${a.total ? (o.sessions / a.total) * 100 : 0}%` }} /></div>
                        <span className="wa-barlist-value">{num(o.sessions)} <span className="wa-muted">{pct(o.sessions, a.total, 0)}</span></span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Recent lead journeys" hint="How each of the latest leads found us and what they did first. No names or contact details are shown here.">
            <DataTable
              rows={conv?.journeys}
              empty="No tracked leads in this period yet."
              columns={[
                { key: 'at', label: 'When' },
                { key: 'channel', label: 'Channel', render: r => <>{r.channel}<span className="wa-muted"> {r.source}</span></> },
                { key: 'landing_path', label: 'Landed on' },
                { key: 'campaign', label: 'Campaign', render: r => r.campaign || '—' },
                { key: 'pageviews', label: 'Pages', num: true, render: r => num(r.pageviews) },
                { key: 'minutes_to_convert', label: 'To details', num: true, render: r => fmtMinutes(r.minutes_to_convert) },
                { key: 'minutes_to_book', label: 'To book', num: true, render: r => (r.minutes_to_book != null ? fmtMinutes(r.minutes_to_book) : '—') },
                { key: 'classification', label: 'Status', render: r => <JourneyStatus r={r} /> },
              ]}
            />
          </Section>
        </>
      )}

      {/* ── Install tracker modal ── */}
      {showInstall && (
        <div className="modal-overlay" onClick={() => setShowInstall(false)}>
          <div className="modal-card modal-card-wide" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Install the website tracker</h3>
            <p className="modal-subtitle">
              Paste this just before <code>&lt;/head&gt;</code> on every page of sdfmgroup.com (it is already on the site). It measures the whole visitor journey, including the booking page.
            </p>
            <pre className="wa-snippet">{getTrackerSnippet()}</pre>
            <ul className="wa-install-notes">
              <li><strong>Consent:</strong> visits are always counted anonymously (no IP stored, no persistent ID). A returning-visitor ID is only added when the visitor accepts cookies — the tracker reads <code>localStorage.sdfm_cookie_consent</code> (“accepted” / “rejected”). If the marketing site's cookie banner stores consent elsewhere, call <code>window.sdfm.setConsent('accepted' | 'rejected')</code> from it.</li>
              <li><strong>Your own visits:</strong> open any page once with <code>?sdfm_ignore=1</code> (e.g. sdfmgroup.com/?sdfm_ignore=1) on each browser you use, so staff and testing don't pollute the numbers. <code>?sdfm_ignore=0</code> turns tracking back on.</li>
              <li><strong>Call-to-action links:</strong> every button that leads to the booking page, WhatsApp, phone or email carries <code>data-sdfm-cta</code> and a <code>data-sdfm-label</code> naming where it sits (for example <code>hero_book</code>), so you can see which placements get clicks. Add the attribute to any new CTA you create.</li>
              <li><strong>Privacy policy:</strong> update the cookie section of your privacy policy to mention first-party analytics.</li>
            </ul>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={copySnippet}>Copy snippet</button>
              <button className="btn btn-primary" onClick={() => setShowInstall(false)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {toast.show && <div className={`toast toast-${toast.type}`}>{toast.text}</div>}
    </div>
  )
}
