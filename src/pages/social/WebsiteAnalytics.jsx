import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { DateTime } from 'luxon'
import { supabase } from '../../lib/supabase'
import { exportCSV } from '../../lib/exportUtils'
import { getTrackerSnippet } from '../../lib/analytics'
import WaChart from './WaChart'
import { CTA_PLACEMENTS } from './waPlacements'
import {
  DEFAULT_TZ, PERIODS, COMPARE, FILTERS, GOALS, FUNNELS, METRICS, SEO_METRICS,
  num, fmtValue, pctOf, change, resolveRange, fillSeries,
  countryInfo, languageName, filterValueLabel,
} from './waUtils'
import './WebsiteAnalytics.css'

// Website Analytics, modelled on Plausible / Fathom / GA4:
//   Overview          headline KPIs with deltas, one trend chart (click a KPI to
//                     switch metric), sources, pages, locations, devices, goals
//   Goals & funnels   every goal, three funnels, contact requests, contact routes, CTAs
//   Search Console    clicks, impressions, CTR, position, queries, pages
// Click any row to filter the whole page by it; filters, period, comparison and
// tab live in the URL so a view can be shared or bookmarked.
// All aggregation happens in Postgres (web_analytics_report / seo_report in
// supabase/migration-website-analytics-v2.sql).

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'goals', label: 'Goals & funnels' },
  { key: 'search', label: 'Search Console' },
]

// Off-site contact routes. Call booking was retired in 2026-11, so old 'book' clicks are not shown.
const METHODS = { whatsapp: 'WhatsApp', phone: 'Phone call', email: 'Email' }

// Goals where a visitor leaves their details for SDFM to contact them.
const CONTACT_GOALS = [
  { key: 'scoper_contact', label: 'After the scoper' },
  { key: 'custom_build', label: 'Custom-build requests' },
  { key: 'industry_enquiry', label: 'Industry enquiries' },
  { key: 'contact_form', label: 'Contact form' },
]

const placementLabel = label => CTA_PLACEMENTS[label] || label

function missingFunction(err) {
  return err && (err.code === 'PGRST202' || /could not find the function/i.test(err.message || ''))
}

// ── small pieces ──────────────────────────────────────────────────────────────

// Counts compare as % change; rates compare as percentage points.
function Delta({ cur, prev, fmt, invert = false, small = false }) {
  if (prev == null || cur == null) return null
  const isRate = fmt === 'pct' || fmt === 'pct2'
  const diff = isRate ? Number(cur) - Number(prev) : change(cur, prev)
  if (diff == null) return <span className={`wa-delta wa-delta-new ${small ? 'sm' : ''}`}>new</span>
  const rounded = Math.round(Math.abs(diff) * (isRate ? 10 : 1)) / (isRate ? 10 : 1)
  if (rounded === 0) return <span className={`wa-delta wa-delta-flat ${small ? 'sm' : ''}`}>0{isRate ? ' pts' : '%'}</span>
  const up = diff > 0
  const good = invert ? !up : up
  return (
    <span className={`wa-delta ${good ? 'wa-delta-good' : 'wa-delta-bad'} ${small ? 'sm' : ''}`} title={`Previous: ${fmtValue(prev, fmt)}`}>
      <span aria-hidden="true">{up ? '↑' : '↓'}</span>
      <span className="sr-only">{up ? 'up' : 'down'}</span>
      {rounded.toLocaleString('en-US')}{isRate ? ' pts' : '%'}
    </span>
  )
}

function KpiGrid({ metrics, kpis, prevKpis, selected, onSelect, cols = 4 }) {
  return (
    <div className={`wa-kpis wa-kpis-${cols}`} role="tablist" aria-label="Choose the metric for the chart">
      {metrics.map(m => (
        <button
          key={m.key} type="button" role="tab" aria-selected={selected === m.key}
          className={`wa-kpi ${selected === m.key ? 'active' : ''}`}
          onClick={() => onSelect(m.key)}
        >
          <span className="wa-kpi-label">{m.label}</span>
          <span className="wa-kpi-value">{fmtValue(kpis?.[m.key], m.fmt)}</span>
          <span className="wa-kpi-foot">
            {prevKpis ? <Delta cur={kpis?.[m.key]} prev={prevKpis?.[m.key]} fmt={m.fmt} invert={m.invert} /> : <span className="wa-muted">&nbsp;</span>}
          </span>
        </button>
      ))}
    </div>
  )
}

function Card({ title, hint, actions, children, className = '' }) {
  return (
    <section className={`wa-card ${className}`}>
      {(title || actions) && (
        <header className="wa-card-head">
          <div>
            {title && <h2 className="wa-card-title">{title}</h2>}
            {hint && <p className="wa-card-hint">{hint}</p>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  )
}

function Pills({ options, value, onChange, label }) {
  return (
    <div className="wa-pills" role="tablist" aria-label={label}>
      {options.map(o => (
        <button key={o.key} type="button" role="tab" aria-selected={value === o.key}
          className={`wa-pill ${value === o.key ? 'active' : ''}`} onClick={() => onChange(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

// A ranked list: label with a proportional bar behind it, then value columns.
// Rows are buttons when `onPick` is given (click = filter by that row).
function RankList({ rows, columns, labelFor, onPick, activeValue, empty = 'No data in this period.', limit }) {
  const list = (rows || []).slice(0, limit || undefined)
  if (list.length === 0) return <div className="wa-empty">{empty}</div>
  const main = columns[0].key
  const max = Math.max(1, ...list.map(r => Number(r[main]) || 0))
  return (
    <div className="wa-rank" role="table">
      <div className="wa-rank-row wa-rank-head" role="row">
        <span className="wa-rank-label" role="columnheader">{columns.label || ''}</span>
        {columns.map(c => <span key={c.key} className={`wa-rank-val ${c.hideSm ? 'wa-hide-sm' : ''}`} role="columnheader">{c.label}</span>)}
      </div>
      {list.map((r, i) => {
        const content = labelFor ? labelFor(r) : r.name
        const active = activeValue != null && activeValue === r.name
        const Tag = onPick ? 'button' : 'div'
        return (
          <Tag
            key={`${r.name}-${i}`} role="row" type={onPick ? 'button' : undefined}
            className={`wa-rank-row ${onPick ? 'clickable' : ''} ${active ? 'active' : ''}`}
            onClick={onPick ? () => onPick(r) : undefined}
            title={onPick ? 'Filter by this' : undefined}
          >
            <span className="wa-rank-label" role="cell">
              <span className="wa-rank-bar" style={{ width: `${((Number(r[main]) || 0) / max) * 100}%` }} />
              <span className="wa-rank-text">{content}</span>
            </span>
            {columns.map(c => (
              <span key={c.key} className={`wa-rank-val ${c.hideSm ? 'wa-hide-sm' : ''}`} role="cell">
                {c.render ? c.render(r) : fmtValue(r[c.key], c.fmt)}
              </span>
            ))}
          </Tag>
        )
      })}
    </div>
  )
}

// A card with sub-tabs, each a RankList. "View all" opens the full list.
function BreakdownCard({ title, views, onFilter, filters }) {
  const [active, setActive] = useState(views[0].key)
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState('')
  const view = views.find(v => v.key === active) || views[0]
  const pick = view.filterKey && onFilter ? r => { onFilter(view.filterKey, r.name); setExpanded(false) } : undefined
  const rows = view.rows || []
  const shown = 8
  const filtered = query ? rows.filter(r => String(view.text ? view.text(r) : r.name).toLowerCase().includes(query.toLowerCase())) : rows
  return (
    <Card
      title={title}
      actions={views.length > 1 && <Pills options={views} value={view.key} onChange={k => { setActive(k); setExpanded(false) }} label={`${title} view`} />}
      className="wa-breakdown"
    >
      <RankList rows={rows} columns={view.columns} labelFor={view.labelFor} onPick={pick} limit={shown}
        activeValue={view.filterKey ? filters?.[view.filterKey] : null} empty={view.empty} />
      {rows.length > shown && (
        <button type="button" className="wa-more" onClick={() => setExpanded(true)}>View all {num(rows.length)}</button>
      )}
      {expanded && (
        <div className="modal-overlay" onClick={() => setExpanded(false)}>
          <div className="modal-card modal-card-wide wa-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label={`${title} · ${view.label}`}>
            <div className="wa-modal-head">
              <h3 className="modal-title">{views.length > 1 ? `${title} · ${view.label}` : title}</h3>
              <button type="button" className="wa-icon-btn" onClick={() => setExpanded(false)} aria-label="Close">×</button>
            </div>
            <input className="wa-search" type="search" placeholder="Search" value={query} onChange={e => setQuery(e.target.value)} autoFocus />
            <div className="wa-modal-body">
              <RankList rows={filtered} columns={view.columns} labelFor={view.labelFor} onPick={pick}
                activeValue={view.filterKey ? filters?.[view.filterKey] : null} />
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}

function Funnel({ def, counts, prevCounts }) {
  const steps = def.steps.map((label, i) => ({ label, count: Number(counts?.[i] || 0) }))
  const base = steps[0]?.count || 0
  let worst = -1
  let worstRate = 0
  steps.forEach((s, i) => {
    if (i < 2) return // "all visits -> opened the page" is mostly people who never meant to
    const prev = steps[i - 1].count
    const drop = prev > 0 ? (prev - s.count) / prev : 0
    if (drop > worstRate) { worstRate = drop; worst = i }
  })
  const last = steps[steps.length - 1]
  const prevLast = prevCounts ? Number(prevCounts[prevCounts.length - 1] || 0) : null
  return (
    <div className="wa-funnel">
      <div className="wa-funnel-summary">
        <div>
          <span className="wa-kpi-label">Completed</span>
          <span className="wa-funnel-big">{num(last.count)}</span>
          {prevCounts && <Delta cur={last.count} prev={prevLast} fmt="num" small />}
        </div>
        <div>
          <span className="wa-kpi-label">Of all visits</span>
          <span className="wa-funnel-big">{fmtValue(pctOf(last.count, base), 'pct')}</span>
        </div>
        <div>
          <span className="wa-kpi-label">Of those who opened it</span>
          <span className="wa-funnel-big">{fmtValue(pctOf(last.count, steps[1]?.count || 0), 'pct')}</span>
        </div>
      </div>
      <ol className="wa-funnel-steps">
        {steps.map((s, i) => {
          const prev = i > 0 ? steps[i - 1].count : null
          const stepRate = prev ? pctOf(s.count, prev) : null
          return (
            <li key={s.label} className={`wa-funnel-step ${i === worst ? 'worst' : ''}`}>
              <div className="wa-funnel-meta">
                <span className="wa-funnel-n">{i + 1}</span>
                <span className="wa-funnel-label">{s.label}</span>
                <span className="wa-funnel-count">{num(s.count)} <span className="wa-muted">{fmtValue(pctOf(s.count, base), 'pct')}</span></span>
              </div>
              <div className="wa-funnel-track"><div className="wa-funnel-fill" style={{ width: `${base ? Math.max(s.count ? 1.5 : 0, pctOf(s.count, base)) : 0}%` }} /></div>
              {i > 0 && (
                <div className="wa-funnel-drop">
                  {stepRate != null ? `${fmtValue(stepRate, 'pct')} continued from the step before` : 'No one reached the step before'}
                  {prev > 0 && prev > s.count && <span> · {num(prev - s.count)} dropped off</span>}
                  {i === worst && <span className="wa-chip wa-chip-warn">biggest drop</span>}
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function MiniStat({ label, value, sub }) {
  return (
    <div className="wa-mini">
      <span className="wa-kpi-label">{label}</span>
      <span className="wa-mini-value">{value}</span>
      {sub && <span className="wa-muted wa-mini-sub">{sub}</span>}
    </div>
  )
}

function Table({ columns, rows, empty = 'No data in this period.', onRow, activeKey }) {
  if (!rows || rows.length === 0) return <div className="wa-empty">{empty}</div>
  return (
    <div className="wa-table-wrap">
      <table className="wa-table">
        <thead>
          <tr>{columns.map(c => <th key={c.key} className={`${c.num ? 'num' : ''} ${c.hideSm ? 'wa-hide-sm' : ''}`}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.name || i} className={`${onRow ? 'clickable' : ''} ${activeKey && activeKey === r.name ? 'active' : ''}`}
              onClick={onRow ? () => onRow(r) : undefined}
              tabIndex={onRow ? 0 : undefined}
              onKeyDown={onRow ? e => { if (e.key === 'Enter') onRow(r) } : undefined}>
              {columns.map(c => (
                <td key={c.key} className={`${c.num ? 'num' : ''} ${c.hideSm ? 'wa-hide-sm' : ''}`}>{c.render ? c.render(r) : r[c.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function WebsiteAnalytics() {
  const [params, setParams] = useSearchParams()
  const [tz, setTz] = useState(DEFAULT_TZ)
  const [web, setWeb] = useState({ cur: null, prev: null, loading: true, error: null })
  const [conv, setConv] = useState({ data: null, loading: false, error: null })
  const [seo, setSeo] = useState({ cur: null, prev: null, loading: false, error: null })
  const [showInstall, setShowInstall] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [toast, setToast] = useState(null)
  const reqWeb = useRef(0)
  const reqSeo = useRef(0)
  const reqConv = useRef(0)

  // URL state
  const tab = TABS.some(t => t.key === params.get('tab')) ? params.get('tab') : 'overview'
  const period = PERIODS.some(p => p.key === params.get('period')) ? params.get('period') : '30d'
  const compare = COMPARE.some(c => c.key === params.get('cmp')) ? params.get('cmp') : 'prev'
  const metric = METRICS.some(m => m.key === params.get('metric')) ? params.get('metric') : 'visitors'
  const seoMetric = SEO_METRICS.some(m => m.key === params.get('smetric')) ? params.get('smetric') : 'clicks'
  const funnelKey = FUNNELS.some(f => f.key === params.get('funnel')) ? params.get('funnel') : 'scoper'
  const customFrom = params.get('from') || ''
  const customTo = params.get('to') || ''
  const filterString = Object.keys(FILTERS).map(k => `${k}=${params.get(`f.${k}`) || ''}`).join('&')
  const filters = useMemo(() => {
    const out = {}
    Object.keys(FILTERS).forEach(k => { const v = params.get(`f.${k}`); if (v) out[k] = v })
    return out
  }, [filterString]) // eslint-disable-line react-hooks/exhaustive-deps
  const seoFilters = useMemo(() => {
    const out = {}
    if (params.get('sq')) out.query = params.get('sq')
    if (params.get('sp')) out.page = params.get('sp')
    return out
  }, [params.get('sq'), params.get('sp')]) // eslint-disable-line react-hooks/exhaustive-deps

  function update(changes) {
    setParams(prev => {
      const next = new URLSearchParams(prev)
      Object.entries(changes).forEach(([k, v]) => { if (v == null || v === '') next.delete(k); else next.set(k, v) })
      return next
    }, { replace: true })
  }
  const addFilter = (key, value) => update({ [`f.${key}`]: value })
  const removeFilter = key => update({ [`f.${key}`]: null })
  const clearFilters = () => update(Object.fromEntries(Object.keys(FILTERS).map(k => [`f.${k}`, null])))

  const range = useMemo(
    () => resolveRange({ period, from: customFrom, to: customTo, compare }, tz),
    [period, customFrom, customTo, compare, tz]
  )
  const todayStr = DateTime.now().setZone(tz).toISODate()

  useEffect(() => {
    supabase.from('system_settings').select('key, value').eq('key', 'team_timezone').maybeSingle()
      .then(({ data: row }) => { if (row?.value) setTz(row.value) })
  }, [])

  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast])

  const bounds = r => ({ p_from: r.from ? r.from.toISOString() : null, p_to: r.to ? r.to.toISOString() : null })

  // Site report: current period (full) + comparison period (compact).
  useEffect(() => {
    const id = ++reqWeb.current
    setWeb(w => ({ ...w, loading: true, error: null }))
    const args = r => ({ ...bounds(r), p_tz: tz, p_filters: filters, p_interval: range.interval })
    Promise.all([
      supabase.rpc('web_analytics_report', { ...args(range), p_compact: false }),
      range.cmp ? supabase.rpc('web_analytics_report', { ...args(range.cmp), p_compact: true }) : Promise.resolve({ data: null }),
    ]).then(([cur, prev]) => {
      if (id !== reqWeb.current) return
      if (cur.error) {
        setWeb({ cur: null, prev: null, loading: false, error: missingFunction(cur.error)
          ? 'The new analytics report is not installed yet. Run supabase/migration-website-analytics-v2.sql, then reload.'
          : `Could not load website analytics: ${cur.error.message}` })
        return
      }
      setWeb({ cur: cur.data, prev: prev.error ? null : prev.data, loading: false, error: null })
    })
  }, [range, tz, filters]) // eslint-disable-line react-hooks/exhaustive-deps

  // Booking journey detail (Goals tab only; not filterable).
  useEffect(() => {
    if (tab !== 'goals') return
    const id = ++reqConv.current
    setConv(c => ({ ...c, loading: true }))
    supabase.rpc('web_analytics_conversion', { ...bounds(range), p_tz: tz }).then(({ data, error }) => {
      if (id !== reqConv.current) return
      setConv({ data: error ? null : data, loading: false, error: error ? error.message : null })
    })
  }, [tab, range, tz]) // eslint-disable-line react-hooks/exhaustive-deps

  // Search Console (Search tab only).
  useEffect(() => {
    if (tab !== 'search') return
    loadSeo()
  }, [tab, range, seoFilters]) // eslint-disable-line react-hooks/exhaustive-deps

  function loadSeo() {
    const id = ++reqSeo.current
    setSeo(s => ({ ...s, loading: true, error: null }))
    Promise.all([
      supabase.rpc('seo_report', { p_from: range.fromDate, p_to: range.toDate, p_filters: seoFilters }),
      range.cmp ? supabase.rpc('seo_report', { p_from: range.cmp.fromDate, p_to: range.cmp.toDate, p_filters: seoFilters }) : Promise.resolve({ data: null }),
    ]).then(([cur, prev]) => {
      if (id !== reqSeo.current) return
      if (cur.error) {
        setSeo({ cur: null, prev: null, loading: false, error: missingFunction(cur.error)
          ? 'Run supabase/migration-website-analytics-v2.sql to enable this tab.'
          : cur.error.message })
        return
      }
      setSeo({ cur: cur.data, prev: prev.error ? null : prev.data, loading: false, error: null })
    })
  }

  async function syncSearchConsole() {
    setSyncing(true)
    try {
      const { data: res, error: fnError } = await supabase.functions.invoke('sm-gsc-sync', { body: {} })
      if (fnError) throw new Error('Could not reach the sync function. Is sm-gsc-sync deployed?')
      if (!res?.success) throw new Error(res?.error || 'Sync failed')
      setToast({ type: 'success', text: res.skipped ? 'Already synced a moment ago' : `Search Console synced (${num(res.rows?.queries)} query rows)` })
      loadSeo()
    } catch (err) {
      setToast({ type: 'error', text: err.message })
    } finally {
      setSyncing(false)
    }
  }

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(getTrackerSnippet())
      setToast({ type: 'success', text: 'Snippet copied' })
    } catch {
      setToast({ type: 'error', text: 'Could not copy — select the text and copy it manually' })
    }
  }

  // ── derived ──
  const cur = web.cur
  const prev = web.prev
  const kpis = cur?.kpis
  const metricDef = METRICS.find(m => m.key === metric)
  const compareLabel = range.cmp ? (compare === 'year' ? 'Same period last year' : 'Previous period') : null

  const series = useMemo(() => {
    if (!cur) return []
    const keys = METRICS.map(m => m.key)
    const pts = fillSeries(cur.series, range, tz, keys)
    if (range.cmp && prev?.series) {
      const prevPts = fillSeries(prev.series, { ...range.cmp, interval: range.interval }, tz, keys, 'bucket', range.cmp.end)
      pts.forEach((p, i) => {
        p.prevPoint = prevPts[i] || null
      })
    }
    return pts
  }, [cur, prev, range, tz])
  const chartPoints = series.map(p => ({
    key: p.key, label: p.label, longLabel: p.longLabel,
    value: p[metric],
    prev: p.prevPoint ? p.prevPoint[metric] : null,
    prevLabel: p.prevPoint?.longLabel,
  }))

  const goalRows = useMemo(() => {
    const visits = kpis?.visits || 0
    const pv = prev?.kpis?.visits || 0
    return GOALS.map(g => {
      const r = (cur?.goals || []).find(x => x.goal === g.key)
      const p = (prev?.goals || []).find(x => x.goal === g.key)
      return {
        ...g, name: g.key,
        visitors: r?.visitors || 0, visits: r?.visits || 0, completions: r?.completions || 0,
        cr: pctOf(r?.visits || 0, visits),
        prevCr: prev ? pctOf(p?.visits || 0, pv) : null,
        prevVisits: prev ? (p?.visits || 0) : null,
      }
    })
  }, [cur, prev, kpis])

  const hasFilters = Object.keys(filters).length > 0
  const noData = !web.loading && !web.error && kpis && kpis.visits === 0 && !hasFilters

  // ── CSV ──
  function handleExportCSV() {
    const rows = [['Period', range.label], ['Filters', Object.entries(filters).map(([k, v]) => `${FILTERS[k]}: ${filterValueLabel(k, v)}`).join('; ') || 'none'], ['']]
    if (tab === 'search' && seo.cur) {
      const s = seo.cur
      rows.push(['Clicks', s.totals.clicks], ['Impressions', s.totals.impressions], ['CTR %', s.totals.ctr], ['Avg position', s.totals.position ?? ''], [''])
      rows.push(['Query', 'Clicks', 'Impressions', 'CTR %', 'Position'], ...s.queries.map(q => [q.name, q.clicks, q.impressions, q.ctr, q.position]), [''])
      rows.push(['Page', 'Clicks', 'Impressions', 'CTR %', 'Position', 'Organic visits', 'Organic conversions'], ...s.pages.map(p => [p.name, p.clicks, p.impressions, p.ctr, p.position, p.organic_visits, p.organic_conversions]))
    } else if (cur) {
      METRICS.forEach(m => rows.push([m.label, kpis?.[m.key] ?? '', prev ? `previous: ${prev.kpis?.[m.key] ?? ''}` : '']))
      const block = (title, list, cols) => { rows.push([title, ...cols.map(c => c[0])], ...(list || []).map(r => [r.name, ...cols.map(c => r[c[1]] ?? '')]), ['']) }
      block('Channel', cur.channels, [['Visitors', 'visitors'], ['Visits', 'visits'], ['Conversions', 'conversions'], ['Bounce %', 'bounce_rate']])
      block('Source', cur.sources, [['Visitors', 'visitors'], ['Visits', 'visits'], ['Conversions', 'conversions'], ['Bounce %', 'bounce_rate']])
      block('Referrer', cur.referrers, [['Visitors', 'visitors'], ['Visits', 'visits'], ['Conversions', 'conversions']])
      block('Campaign', cur.campaigns, [['Visitors', 'visitors'], ['Visits', 'visits'], ['Conversions', 'conversions']])
      block('Page', cur.pages, [['Visitors', 'visitors'], ['Pageviews', 'pageviews'], ['Time on page (s)', 'time_on_page'], ['Scroll %', 'scroll']])
      block('Entry page', cur.entry_pages, [['Visitors', 'visitors'], ['Visits', 'visits'], ['Bounce %', 'bounce_rate'], ['Conversions', 'conversions']])
      block('Exit page', cur.exit_pages, [['Visitors', 'visitors'], ['Exits', 'exits'], ['Exit rate %', 'exit_rate']])
      block('Device', cur.devices, [['Visitors', 'visitors'], ['Visits', 'visits']])
      block('Browser', cur.browsers, [['Visitors', 'visitors'], ['Visits', 'visits']])
      block('OS', cur.systems, [['Visitors', 'visitors'], ['Visits', 'visits']])
      block('Country', (cur.countries || []).map(c => ({ ...c, name: countryInfo(c.name).name })), [['Visitors', 'visitors'], ['Visits', 'visits']])
      rows.push(['Goal', 'Visits', 'Completions', 'Conversion rate %'], ...goalRows.map(g => [g.label, g.visits, g.completions, g.cr.toFixed(1)]), [''])
      FUNNELS.forEach(f => {
        rows.push([`Funnel: ${f.label}`, 'Visits'], ...f.steps.map((s, i) => [s, cur.funnels?.[f.key]?.[i] ?? 0]), [''])
      })
    }
    exportCSV(['Metric', 'Value'], rows.map(r => r.map(String)), `SDFM_Website_Analytics_${tab}_${DateTime.now().toISODate()}`)
  }

  // ── header ──
  const header = (
    <div className="wa-header">
      <div className="wa-title-row">
        <div>
          <h1 className="page-title">Website Analytics</h1>
          <p className="page-subtitle">
            sdfmgroup.com · {range.label}
            {range.cmp && <span className="wa-muted"> vs {range.cmp.label}</span>}
            {cur?.live != null && (
              <span className="wa-live" title="Visits active in the last 5 minutes"><span className="wa-live-dot" />{num(cur.live)} online now</span>
            )}
          </p>
        </div>
        <div className="wa-actions">
          <button className="btn btn-secondary btn-sm" onClick={() => setShowInstall(true)}>Tracker</button>
          <button className="btn btn-secondary btn-sm" onClick={handleExportCSV} disabled={!cur}>Export CSV</button>
        </div>
      </div>

      <div className="wa-controls">
        <label className="wa-select">
          <span className="sr-only">Period</span>
          <select value={period} onChange={e => {
            const v = e.target.value
            if (v === 'custom' && !customFrom) {
              const t = DateTime.now().setZone(tz).startOf('day')
              update({ period: v, from: t.minus({ days: 6 }).toISODate(), to: t.toISODate() })
            } else update({ period: v })
          }}>
            {PERIODS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </label>
        {period === 'custom' && (
          <div className="wa-daterange" role="group" aria-label="Custom date range">
            <input type="date" aria-label="From" value={customFrom} max={todayStr}
              onChange={e => e.target.value && update({ from: e.target.value, to: customTo && customTo < e.target.value ? e.target.value : customTo })} />
            <span className="wa-muted">to</span>
            <input type="date" aria-label="To" value={customTo} min={customFrom || undefined} max={todayStr}
              onChange={e => e.target.value && update({ to: e.target.value })} />
          </div>
        )}
        {period !== 'all' && (
          <label className="wa-select">
            <span className="sr-only">Compare with</span>
            <select value={compare} onChange={e => update({ cmp: e.target.value })}>
              {COMPARE.map(c => <option key={c.key} value={c.key}>{c.key === 'off' ? c.label : `vs ${c.label.toLowerCase()}`}</option>)}
            </select>
          </label>
        )}
      </div>

      {hasFilters && (
        <div className="wa-filters" aria-label="Active filters">
          {Object.entries(filters).map(([k, v]) => (
            <span key={k} className="wa-filter-chip">
              <span className="wa-muted">{FILTERS[k]} is</span> <strong>{filterValueLabel(k, v)}</strong>
              <button type="button" onClick={() => removeFilter(k)} aria-label={`Remove ${FILTERS[k]} filter`}>×</button>
            </span>
          ))}
          <button type="button" className="wa-link" onClick={clearFilters}>Clear all</button>
        </div>
      )}

      <nav className="wa-tabs" role="tablist" aria-label="Website Analytics sections">
        {TABS.map(t => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key}
            className={`wa-tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => update({ tab: t.key === 'overview' ? null : t.key })}>{t.label}</button>
        ))}
      </nav>
    </div>
  )

  if (web.error && tab !== 'search') {
    return <div className="wa-page">{header}<Card><div className="wa-empty">{web.error}</div></Card></div>
  }

  return (
    <div className={`wa-page ${web.loading ? 'wa-loading' : ''}`}>
      {header}

      {tab === 'overview' && (
        !cur ? <Skeleton /> : (
          <>
            {noData && (
              <Card className="wa-onboarding" title="No visits recorded in this period">
                <p className="wa-card-hint">The tracker runs on every page of sdfmgroup.com. Pick a longer period, or check the install snippet if the site is new.</p>
                <button className="btn btn-primary btn-sm" onClick={() => setShowInstall(true)}>Show install snippet</button>
              </Card>
            )}
            <KpiGrid metrics={METRICS} kpis={kpis} prevKpis={prev?.kpis} selected={metric}
              onSelect={k => update({ metric: k === 'visitors' ? null : k })} />
            <Card
              title={metricDef.label}
              hint={`By ${range.interval}${metric === 'visit_duration' ? ' · engaged time, tab in focus' : ''}${metric === 'bounce_rate' ? ' · one page, under 10 s, no clicks' : ''}${metric === 'conversions' || metric === 'conversion_rate' ? ' · visits that completed any goal except "Scoper: started"' : ''}`}
              className="wa-chart-card"
            >
              <WaChart points={chartPoints} fmt={metricDef.fmt} metricLabel={range.label} compareLabel={compareLabel} />
            </Card>

            <div className="wa-grid">
              <BreakdownCard
                title="Top sources" filters={filters} onFilter={addFilter}
                views={[
                  { key: 'channels', label: 'Channels', filterKey: 'channel', rows: cur.channels, columns: visitorCols('Channel', true) },
                  { key: 'sources', label: 'Sources', filterKey: 'source', rows: cur.sources, columns: visitorCols('Source', true), labelFor: r => <SourceLabel name={r.name} /> },
                  { key: 'referrers', label: 'Referrers', filterKey: 'referrer', rows: cur.referrers, columns: visitorCols('Referrer', true), labelFor: r => <SourceLabel name={r.name} />, empty: 'No referring sites in this period.' },
                  { key: 'campaigns', label: 'Campaigns', filterKey: 'campaign', rows: cur.campaigns, columns: visitorCols('UTM campaign', true), empty: 'No visits with utm_campaign in this period.' },
                ]}
              />
              <BreakdownCard
                title="Top pages" filters={filters} onFilter={addFilter}
                views={[
                  { key: 'pages', label: 'Pages', filterKey: 'page', rows: cur.pages, columns: withLabel('Page', [
                    { key: 'visitors', label: 'Visitors', fmt: 'num' },
                    { key: 'pageviews', label: 'Views', fmt: 'num', hideSm: true },
                    { key: 'time_on_page', label: 'Time', fmt: 'dur' },
                  ]) },
                  { key: 'entry', label: 'Entry pages', filterKey: 'entry', rows: cur.entry_pages, columns: withLabel('Entry page', [
                    { key: 'visitors', label: 'Visitors', fmt: 'num' },
                    { key: 'bounce_rate', label: 'Bounce', fmt: 'pct', hideSm: true },
                    { key: 'cr', label: 'Conv.', render: r => fmtValue(pctOf(r.conversions, r.visits), 'pct') },
                  ]) },
                  { key: 'exit', label: 'Exit pages', filterKey: 'exit', rows: cur.exit_pages, columns: withLabel('Exit page', [
                    { key: 'visitors', label: 'Visitors', fmt: 'num' },
                    { key: 'exits', label: 'Exits', fmt: 'num', hideSm: true },
                    { key: 'exit_rate', label: 'Exit rate', fmt: 'pct' },
                  ]) },
                ]}
              />
              <BreakdownCard
                title="Locations" filters={filters} onFilter={addFilter}
                views={[
                  { key: 'countries', label: 'Countries', filterKey: 'country', rows: cur.countries, columns: visitorCols('Country'),
                    labelFor: r => { const c = countryInfo(r.name); return <><span className="wa-cc" aria-hidden="true">{c.code}</span>{c.name}</> },
                    text: r => countryInfo(r.name).name },
                  { key: 'languages', label: 'Languages', filterKey: 'language', rows: cur.languages, columns: visitorCols('Language'), labelFor: r => languageName(r.name), text: r => languageName(r.name) },
                  { key: 'hosts', label: 'Hostnames', filterKey: 'hostname', rows: cur.hostnames, columns: visitorCols('Hostname') },
                ]}
              />
              <BreakdownCard
                title="Devices" filters={filters} onFilter={addFilter}
                views={[
                  { key: 'devices', label: 'Device', filterKey: 'device', rows: cur.devices, columns: visitorCols('Device'), labelFor: r => capitalise(r.name) },
                  { key: 'browsers', label: 'Browser', filterKey: 'browser', rows: cur.browsers, columns: visitorCols('Browser') },
                  { key: 'systems', label: 'OS', filterKey: 'os', rows: cur.systems, columns: visitorCols('Operating system') },
                ]}
              />
              <BreakdownCard
                title="Goals" filters={filters} onFilter={addFilter}
                views={[
                  { key: 'goals', label: 'Goals', filterKey: 'goal', rows: goalRows.filter(g => g.visits > 0), columns: withLabel('Goal', [
                    { key: 'visitors', label: 'Uniques', fmt: 'num' },
                    { key: 'completions', label: 'Total', fmt: 'num', hideSm: true },
                    { key: 'cr', label: 'Conv. rate', fmt: 'pct' },
                  ]), labelFor: r => r.label, text: r => r.label, empty: 'No goals completed in this period.' },
                ]}
              />
              <BreakdownCard
                title="Events"
                views={[
                  { key: 'events', label: 'Events', rows: cur.events, columns: withLabel('Event', [
                    { key: 'visits', label: 'Visits', fmt: 'num' },
                    { key: 'events', label: 'Total', fmt: 'num' },
                  ]), labelFor: r => <code className="wa-code">{r.name}</code>, empty: 'No tracked interactions in this period.' },
                ]}
              />
            </div>
            <p className="wa-footnote">
              Visitors are counted without cookies unless the visitor accepted them, so one person on two days can count twice. Country is inferred from the browser's time zone (no IP is stored). Local and preview hosts (localhost) are excluded.
            </p>
          </>
        )
      )}

      {tab === 'goals' && (
        !cur ? <Skeleton /> : (
          <>
            <Card title="Goals" hint="A goal counts once per visit. Conversion rate = visits that completed it ÷ all visits. Click a goal to filter the whole page to those visits.">
              <Table
                rows={goalRows}
                onRow={r => addFilter('goal', r.key)}
                activeKey={filters.goal}
                columns={[
                  { key: 'label', label: 'Goal', render: r => <><span className={`wa-chip wa-chip-${r.group.toLowerCase()}`}>{r.group}</span> {r.label}</> },
                  { key: 'visitors', label: 'Uniques', num: true, render: r => num(r.visitors) },
                  { key: 'completions', label: 'Total', num: true, hideSm: true, render: r => num(r.completions) },
                  { key: 'cr', label: 'Conv. rate', num: true, render: r => fmtValue(r.cr, 'pct') },
                  ...(prev ? [{ key: 'delta', label: 'Change', num: true, hideSm: true, render: r => <Delta cur={r.visits} prev={r.prevVisits} fmt="num" small /> }] : []),
                ]}
              />
            </Card>

            <Card
              title="Funnels"
              hint="Visits reaching each step. A later step counts as passing the earlier ones, so a funnel can only narrow."
              actions={<Pills options={FUNNELS} value={funnelKey} onChange={k => update({ funnel: k === 'scoper' ? null : k })} label="Funnel" />}
            >
              <Funnel def={FUNNELS.find(f => f.key === funnelKey)} counts={cur.funnels?.[funnelKey]} prevCounts={prev?.funnels?.[funnelKey]} />
            </Card>

            <div className="wa-grid">
              <Card title="Contact requests" hint="People who left their details for us to contact them. Each counts once per visit.">
                <div className="wa-minis">
                  {CONTACT_GOALS.map(g => {
                    const row = goalRows.find(r => r.key === g.key)
                    return <MiniStat key={g.key} label={g.label} value={num(row?.visits)} sub={prev ? <Delta cur={row?.visits || 0} prev={row?.prevVisits} fmt="num" small /> : null} />
                  })}
                  <MiniStat label="Visit → request" value={fmtValue(pctOf(CONTACT_GOALS.reduce((t, g) => t + (goalRows.find(r => r.key === g.key)?.visits || 0), 0), kpis?.visits || 0), 'pct2')} />
                </div>
              </Card>
              <Card title="How visitors get in touch" hint="WhatsApp, phone and email clicks anywhere on the site. Ignores the filters above.">
                {conv.loading && !conv.data ? <div className="wa-empty">Loading…</div> : (
                  <RankList
                    rows={(conv.data?.contact_methods || []).filter(m => METHODS[m.method]).map(m => ({ ...m, name: m.method }))}
                    labelFor={r => METHODS[r.name] || r.name}
                    columns={withLabel('Route', [
                      { key: 'sessions', label: 'Visits', fmt: 'num' },
                      { key: 'clicks', label: 'Clicks', fmt: 'num' },
                    ])}
                    empty="No contact clicks in this period."
                  />
                )}
              </Card>
            </div>

            {conv.data && (
              <Card title="Calls to action" hint="Which button placements get clicked (data-sdfm-label on sdfmgroup.com). Ignores the filters above.">
                <Table
                  rows={(conv.data.cta_placements || []).filter(p => METHODS[p.method]).map(p => ({ ...p, name: `${p.label}-${p.method}` }))}
                  empty="No call-to-action clicks in this period."
                  columns={[
                    { key: 'label', label: 'Placement', render: r => placementLabel(r.label) },
                    { key: 'method', label: 'Route', hideSm: true, render: r => METHODS[r.method] || r.method },
                    { key: 'clicks', label: 'Clicks', num: true, render: r => num(r.clicks) },
                    { key: 'sessions', label: 'Visits', num: true, render: r => num(r.sessions) },
                  ]}
                />
              </Card>
            )}
          </>
        )
      )}

      {tab === 'search' && <SearchTab seo={seo} range={range} tz={tz} params={params} update={update} seoMetric={seoMetric} syncing={syncing} onSync={syncSearchConsole} compareLabel={compareLabel} />}

      {showInstall && (
        <div className="modal-overlay" onClick={() => setShowInstall(false)}>
          <div className="modal-card modal-card-wide" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">The website tracker</h3>
            <p className="modal-subtitle">
              Already on every page of sdfmgroup.com, just before <code>&lt;/head&gt;</code>. Add it to any new page or site you want measured.
            </p>
            <pre className="wa-snippet">{getTrackerSnippet()}</pre>
            <ul className="wa-install-notes">
              <li><strong>Privacy:</strong> no IP address is stored and no cookie is set unless the visitor accepts cookies (then a returning-visitor ID is kept). Consent is read from <code>localStorage.sdfm_cookie_consent</code>, or set with <code>window.sdfm.setConsent('accepted' | 'rejected')</code>.</li>
              <li><strong>Your own visits:</strong> open any page once with <code>?sdfm_ignore=1</code> on each browser you use; <code>?sdfm_ignore=0</code> turns tracking back on.</li>
              <li><strong>Buttons:</strong> give every call-to-action <code>data-sdfm-cta</code> and a <code>data-sdfm-label</code> naming where it sits (e.g. <code>hero_gapcheck</code>).</li>
              <li><strong>Goals</strong> come from events the site already sends: <code>gap_check_*</code> (scoper start, report, and leaving details to be contacted), <code>lead_form_submit</code> (custom build / industry / contact forms), and WhatsApp, phone and email clicks.</li>
            </ul>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={copySnippet}>Copy snippet</button>
              <button className="btn btn-primary" onClick={() => setShowInstall(false)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast toast-${toast.type}`}>{toast.text}</div>}
    </div>
  )
}

// ── Search Console tab ────────────────────────────────────────────────────────

function SearchTab({ seo, range, tz, params, update, seoMetric, syncing, onSync, compareLabel }) {
  const [view, setView] = useState('queries')
  const s = seo.cur
  const p = seo.prev
  const sq = params.get('sq')
  const sp = params.get('sp')
  const metricDef = SEO_METRICS.find(m => m.key === seoMetric)

  const points = useMemo(() => {
    if (!s) return []
    const dayRange = { ...range, interval: 'day' }
    const rows = (s.daily || []).map(d => ({ ...d, bucket: d.date }))
    const keys = SEO_METRICS.map(m => m.key)
    const cur = fillSeries(rows, range.start ? dayRange : { ...dayRange, start: null }, tz, keys)
    const prevPts = p && range.cmp ? fillSeries((p.daily || []).map(d => ({ ...d, bucket: d.date })), { ...range.cmp, interval: 'day' }, tz, keys, 'bucket', range.cmp.end) : []
    // Position and CTR have no value on a day without impressions.
    const val = (pt, k) => (pt.empty && (k === 'position' || k === 'ctr') ? null : pt[k])
    return cur.map((pt, i) => ({
      key: pt.key, label: pt.label, longLabel: pt.longLabel,
      value: val(pt, seoMetric),
      prev: prevPts[i] ? val(prevPts[i], seoMetric) : null,
      prevLabel: prevPts[i]?.longLabel,
    }))
  }, [s, p, range, tz, seoMetric])

  const prevQueries = useMemo(() => new Map((p?.queries || []).map(q => [q.name, q])), [p])
  const prevPages = useMemo(() => new Map((p?.pages || []).map(q => [q.name, q])), [p])

  if (seo.error) return <Card><div className="wa-empty">{seo.error}</div></Card>
  if (!s) return <Skeleton />

  const status = s.status || {}
  const notConfigured = !status.gsc_site_url
  const lastSync = status.gsc_last_sync_at ? DateTime.fromISO(status.gsc_last_sync_at).setZone(tz) : null
  const syncOk = !status.gsc_last_sync_status || status.gsc_last_sync_status === 'ok'
  const lastDate = s.totals?.last_date

  const posChange = (curPos, prevPos) => {
    if (curPos == null || prevPos == null) return null
    const d = Math.round((prevPos - curPos) * 10) / 10 // positive = moved up
    if (d === 0) return <span className="wa-delta wa-delta-flat sm">0</span>
    return <span className={`wa-delta sm ${d > 0 ? 'wa-delta-good' : 'wa-delta-bad'}`} title={`Previous: ${prevPos}`}>{d > 0 ? '↑' : '↓'}{Math.abs(d)}</span>
  }

  const queryCols = [
    { key: 'name', label: 'Query' },
    { key: 'clicks', label: 'Clicks', num: true, render: r => <>{num(r.clicks)} {p && <Delta cur={r.clicks} prev={prevQueries.get(r.name)?.clicks ?? 0} fmt="num" small />}</> },
    { key: 'impressions', label: 'Impr.', num: true, render: r => num(r.impressions) },
    { key: 'ctr', label: 'CTR', num: true, hideSm: true, render: r => fmtValue(r.ctr, 'pct2') },
    { key: 'position', label: 'Position', num: true, render: r => <>{fmtValue(r.position, 'dec1')} {p && posChange(r.position, prevQueries.get(r.name)?.position)}</> },
  ]
  const pageCols = [
    { key: 'name', label: 'Page' },
    { key: 'clicks', label: 'Clicks', num: true, render: r => <>{num(r.clicks)} {p && <Delta cur={r.clicks} prev={prevPages.get(r.name)?.clicks ?? 0} fmt="num" small />}</> },
    { key: 'impressions', label: 'Impr.', num: true, render: r => num(r.impressions) },
    { key: 'position', label: 'Position', num: true, hideSm: true, render: r => <>{fmtValue(r.position, 'dec1')} {p && posChange(r.position, prevPages.get(r.name)?.position)}</> },
    { key: 'organic_visits', label: 'Organic visits', num: true, hideSm: true, render: r => num(r.organic_visits) },
    { key: 'organic_conversions', label: 'Conv.', num: true, render: r => num(r.organic_conversions) },
  ]

  return (
    <>
      <div className={`wa-sync ${syncOk ? '' : 'error'}`}>
        <div>
          {notConfigured ? (
            <strong>Search Console is not connected.</strong>
          ) : (
            <>
              <strong>{status.gsc_site_url}</strong>
              <span className="wa-muted"> · last synced {lastSync ? lastSync.toRelative() : 'never'}{lastDate ? ` · data up to ${DateTime.fromISO(lastDate).toFormat('d LLL')}` : ''}</span>
              {!syncOk && <div className="wa-sync-error">{status.gsc_last_sync_status}</div>}
            </>
          )}
          <div className="wa-muted wa-sync-note">Google reports search data 2–3 days late. A daily job re-syncs the last 10 days at 05:30 Nairobi time.</div>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={onSync} disabled={syncing || notConfigured}>{syncing ? 'Syncing…' : 'Sync now'}</button>
      </div>

      {notConfigured ? (
        <Card title="Connect Search Console">
          <p className="wa-card-hint">Add the service account to the Search Console property and set the property in Settings → Integrations. See README → Website Analytics for the steps.</p>
        </Card>
      ) : (
        <>
          {(sq || sp) && (
            <div className="wa-filters">
              {sq && <span className="wa-filter-chip"><span className="wa-muted">Query is</span> <strong>{sq}</strong><button type="button" onClick={() => update({ sq: null })} aria-label="Remove query filter">×</button></span>}
              {sp && <span className="wa-filter-chip"><span className="wa-muted">Page is</span> <strong>{sp}</strong><button type="button" onClick={() => update({ sp: null })} aria-label="Remove page filter">×</button></span>}
            </div>
          )}
          <KpiGrid metrics={SEO_METRICS} kpis={s.totals} prevKpis={p?.totals} selected={seoMetric}
            onSelect={k => update({ smetric: k === 'clicks' ? null : k })} />
          <Card title={metricDef.label} hint={seoMetric === 'position' ? 'Lower is better: 1 is the top result.' : 'Google search results, by day.'} className="wa-chart-card">
            <WaChart points={points} fmt={metricDef.fmt} metricLabel={range.label} compareLabel={compareLabel} reverse={seoMetric === 'position'} />
          </Card>

          <Card
            title="Search performance"
            hint={view === 'opportunities' ? 'Queries already on page 1–2 (position 4–20) with at least 10 impressions: a better title, description or section can win the click.' : 'Click a row to filter this tab by it.'}
            actions={<Pills options={[{ key: 'queries', label: 'Queries' }, { key: 'pages', label: 'Pages' }, { key: 'opportunities', label: 'Opportunities' }]} value={view} onChange={setView} label="Search table" />}
          >
            {view === 'queries' && <Table rows={s.queries} columns={queryCols} onRow={r => update({ sq: r.name })} activeKey={sq} empty="No queries in this period. Google hides rare queries for privacy." />}
            {view === 'pages' && <Table rows={s.pages} columns={pageCols} onRow={r => update({ sp: r.name })} activeKey={sp} />}
            {view === 'opportunities' && <Table rows={s.opportunities} columns={queryCols} onRow={r => update({ sq: r.name })} activeKey={sq} empty="No striking-distance queries yet." />}
          </Card>

          <div className="wa-grid">
            <Card title="Countries" hint="Whole site; not affected by query or page filters.">
              <RankList rows={s.countries} columns={withLabel('Country', [{ key: 'clicks', label: 'Clicks', fmt: 'num' }, { key: 'impressions', label: 'Impr.', fmt: 'num' }])}
                labelFor={r => { const c = countryInfo(r.name); return <><span className="wa-cc" aria-hidden="true">{c.code}</span>{c.name}</> }} limit={10} />
            </Card>
            <Card title="Devices" hint="Whole site; not affected by query or page filters.">
              <RankList rows={s.devices} columns={withLabel('Device', [{ key: 'clicks', label: 'Clicks', fmt: 'num' }, { key: 'impressions', label: 'Impr.', fmt: 'num' }, { key: 'position', label: 'Position', fmt: 'dec1' }])}
                labelFor={r => capitalise(r.name)} />
            </Card>
          </div>
        </>
      )}
    </>
  )
}

// ── helpers used in JSX ──

function withLabel(label, cols) {
  const c = [...cols]
  c.label = label
  return c
}

function visitorCols(label, withBounce = false) {
  return withLabel(label, [
    { key: 'visitors', label: 'Visitors', fmt: 'num' },
    ...(withBounce ? [{ key: 'bounce_rate', label: 'Bounce', fmt: 'pct', hideSm: true }] : []),
    { key: 'cr', label: 'Conv.', render: r => fmtValue(pctOf(r.conversions, r.visits), 'pct') },
  ])
}

function SourceLabel({ name }) {
  const domain = /\./.test(name) ? name : SOURCE_DOMAINS[name]
  return (
    <>
      {domain && <img className="wa-favicon" alt="" loading="lazy" src={`https://icons.duckduckgo.com/ip3/${domain}.ico`} onError={e => { e.currentTarget.style.display = 'none' }} />}
      {name === '(direct)' ? 'Direct / none' : name}
    </>
  )
}

const SOURCE_DOMAINS = {
  google: 'google.com', bing: 'bing.com', duckduckgo: 'duckduckgo.com', yahoo: 'yahoo.com', linkedin: 'linkedin.com',
  facebook: 'facebook.com', instagram: 'instagram.com', twitter: 'x.com', youtube: 'youtube.com', whatsapp: 'whatsapp.com',
  tiktok: 'tiktok.com', reddit: 'reddit.com', gmail: 'mail.google.com', outlook: 'outlook.com', chatgpt: 'chatgpt.com',
}

function capitalise(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

function Skeleton() {
  return (
    <>
      <div className="wa-kpis wa-kpis-4">{[1, 2, 3, 4, 5, 6, 7, 8].map(i => <div key={i} className="skeleton wa-kpi-skel" />)}</div>
      <div className="skeleton" style={{ height: 300, borderRadius: 'var(--radius-lg)', marginBottom: 'var(--space-lg)' }} />
    </>
  )
}

