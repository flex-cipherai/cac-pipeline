import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { INTERACTION_MEDIUMS, MEDIUM_BY_KEY, isStale, hoursQuiet, timeAgo, money, pct } from '../lib/pipeline'
import './Overview.css'

// The BMS-wide overview: what happened across sales, marketing and Ospod, and what needs someone now.
// Every section is gated by the module it summarises (Settings → Permissions), so each person sees only
// what they could open anyway. All reads are small and run in parallel.

const RANGES = [
  { key: 7, label: '7 days' },
  { key: 30, label: '30 days' },
  { key: 90, label: '90 days' },
]
const DAY = 86_400_000

const ok = res => (res && !res.error ? res.data || [] : [])
const count = res => (res && !res.error ? res.count ?? 0 : null)

function Delta({ now, before }) {
  if (before == null || now == null) return null
  if (before === 0 && now === 0) return <span className="ov-delta">no change</span>
  if (before === 0) return <span className="ov-delta ov-up">new</span>
  const d = Math.round(((now - before) / before) * 100)
  if (d === 0) return <span className="ov-delta">no change</span>
  return <span className={`ov-delta ${d > 0 ? 'ov-up' : 'ov-down'}`}>{d > 0 ? '▲' : '▼'} {Math.abs(d)}%</span>
}

function Kpi({ label, value, sub, to, now, before, tone }) {
  const body = (
    <>
      <span className="ov-kpi-label">{label}</span>
      <strong className={`ov-kpi-value ${tone ? `ov-${tone}` : ''}`}>{value ?? '—'}</strong>
      <span className="ov-kpi-sub">{sub}<Delta now={now} before={before} /></span>
    </>
  )
  return to ? <Link to={to} className="ov-kpi">{body}</Link> : <div className="ov-kpi">{body}</div>
}

function Sparkbars({ series, label }) {
  const max = Math.max(1, ...series)
  return (
    <div className="ov-spark" role="img" aria-label={label}>
      {series.map((v, i) => <span key={i} style={{ height: `${Math.max(4, (v / max) * 100)}%` }} title={String(v)} />)}
    </div>
  )
}

function greeting(d) {
  const h = d.getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export default function Dashboard() {
  const { profile, can } = useAuth()
  const [range, setRange] = useState(() => { try { return Number(localStorage.getItem('ov_range')) || 7 } catch { return 7 } })
  const [data, setData] = useState(null)
  const now = new Date()

  const see = {
    pipeline: can('pipeline') || can('dashboard'),
    inquiries: can('inquiries'),
    calls: can('leads') || can('pipeline'),
    social: can('social_calendar') || can('social_analytics'),
    inbox: can('social_activity'),
    approvals: can('social_approvals'),
    web: can('website_analytics'),
    ospod: can('ospod_waitlist'),
  }

  useEffect(() => { try { localStorage.setItem('ov_range', String(range)) } catch { /* private mode */ } load() }, [range])

  async function load() {
    const t = Date.now()
    const from = new Date(t - range * DAY).toISOString()
    const prevFrom = new Date(t - 2 * range * DAY).toISOString()
    const today = new Date().toISOString().slice(0, 10)
    const week = new Date(t + 7 * DAY).toISOString()
    const skip = Promise.resolve(null)
    const q = {
      leads: see.pipeline ? supabase.from('pipeline_leads').select('id, full_name, company_name, stage, entry_point, source_channel, created_at, won_at, last_interaction_at, estimated_value, currency, owner_id').eq('service_line', 'custom_build') : skip,
      runs: see.pipeline ? supabase.from('gap_assessments').select('id, company_name, status, created_at, report_generated_at, pipeline_lead_id, contact_requested_at').gte('created_at', prevFrom) : skip,
      acts: see.pipeline ? supabase.from('pipeline_activities').select('id, lead_id, medium, summary, occurred_at, author:created_by(name), lead:lead_id(full_name, company_name)').order('created_at', { ascending: false }).limit(12) : skip,
      inq: see.inquiries ? supabase.from('inquiries').select('id, full_name, company_name, status, received_at, first_response_at, next_follow_up').in('status', ['new', 'contacted', 'engaged']) : skip,
      inqNew: see.inquiries ? supabase.from('inquiries').select('id, full_name, company_name, received_at').gte('received_at', prevFrom) : skip,
      calls: see.calls ? supabase.from('leads').select('id, full_name, company_name, scheduled_date, scheduled_time, current_stage').eq('is_lost', false).gte('scheduled_date', today).order('scheduled_date').limit(5) : skip,
      posted: see.social ? supabase.from('posts').select('id, caption, posted_at, external_post_url').eq('status', 'posted').gte('posted_at', prevFrom).order('posted_at', { ascending: false }) : skip,
      upcoming: see.social ? supabase.from('posts').select('id, caption, scheduled_at, status').in('status', ['scheduled', 'ready_to_post']).gte('scheduled_at', new Date(t).toISOString()).lte('scheduled_at', week).order('scheduled_at').limit(5) : skip,
      failed: see.social ? supabase.from('posts').select('id', { count: 'exact', head: true }).eq('status', 'failed') : skip,
      approvals: see.approvals ? supabase.from('posts').select('id', { count: 'exact', head: true }).eq('status', 'pending_approval') : skip,
      inbox: see.inbox ? supabase.from('activity_events').select('id', { count: 'exact', head: true }).eq('triage_status', 'needs_response') : skip,
      web: see.web ? supabase.from('web_sessions').select('started_at').gte('started_at', prevFrom).limit(20000) : skip,
      ospod: see.ospod ? supabase.from('ospod_waitlist_signups').select('id, email, created_at').gte('created_at', prevFrom).order('created_at', { ascending: false }) : skip,
      ospodTotal: see.ospod ? supabase.from('ospod_waitlist_signups').select('id', { count: 'exact', head: true }) : skip,
    }
    const keys = Object.keys(q)
    const res = await Promise.all(keys.map(k => q[k]))
    const r = Object.fromEntries(keys.map((k, i) => [k, res[i]]))
    setData({ r, from, prevFrom })
  }

  if (!data) {
    return (
      <div className="ov-page">
        <div className="ov-head"><div className="skeleton" style={{ width: 260, height: 30 }} /></div>
        <div className="ov-kpis">{[0, 1, 2, 3].map(i => <div key={i} className="ov-kpi skeleton" style={{ height: 112 }} />)}</div>
      </div>
    )
  }

  const { r, from, prevFrom } = data
  const inRange = iso => iso && iso >= from
  const inPrev = iso => iso && iso >= prevFrom && iso < from

  // ── Pipeline ──
  const leads = ok(r.leads)
  const runs = ok(r.runs)
  const active = leads.filter(l => l.stage === 'active')
  const stale = active.filter(l => isStale(l, now)).sort((a, b) => hoursQuiet(b, now) - hoursQuiet(a, now))
  const runsNow = runs.filter(x => inRange(x.created_at)).length
  const runsPrev = runs.filter(x => inPrev(x.created_at)).length
  const asked = runs.filter(x => inRange(x.created_at) && (x.pipeline_lead_id || x.contact_requested_at)).length
  const newLeadsNow = leads.filter(l => inRange(l.created_at)).length
  const newLeadsPrev = leads.filter(l => inPrev(l.created_at)).length
  const wonNow = leads.filter(l => inRange(l.won_at)).length
  const wonPrev = leads.filter(l => inPrev(l.won_at)).length
  const openValue = active.reduce((s, l) => s + (Number(l.estimated_value) || 0), 0)
  const valueCur = active.find(l => l.estimated_value)?.currency || 'KES'

  // ── Inquiries ──
  const openInq = ok(r.inq)
  const waiting = openInq.filter(i => i.status === 'new' && !i.first_response_at && now - new Date(i.received_at) > DAY)
  const followDue = openInq.filter(i => i.next_follow_up && i.next_follow_up <= now.toISOString().slice(0, 10))
  const inqNew = ok(r.inqNew)

  // ── Marketing ──
  const posted = ok(r.posted)
  const postedNow = posted.filter(p => inRange(p.posted_at)).length
  const postedPrev = posted.filter(p => inPrev(p.posted_at)).length
  const web = ok(r.web)
  const visitsNow = web.filter(s => inRange(s.started_at)).length
  const visitsPrev = web.filter(s => inPrev(s.started_at)).length
  const days = Math.min(range, 30)
  const visitSeries = Array.from({ length: days }, (_, i) => {
    const start = now.getTime() - (days - i) * DAY
    return web.filter(s => { const t = new Date(s.started_at).getTime(); return t >= start && t < start + DAY }).length
  })
  const ospod = ok(r.ospod)
  const ospodNow = ospod.filter(o => inRange(o.created_at)).length
  const ospodPrev = ospod.filter(o => inPrev(o.created_at)).length

  // ── Needs attention ──
  const attention = []
  if (see.pipeline && stale.length) attention.push({ key: 'stale', tone: 'red', to: '/pipeline?filter=attention', title: `${stale.length} pipeline lead${stale.length === 1 ? '' : 's'} with no contact for 48h`, sub: stale.slice(0, 3).map(l => l.company_name || l.full_name).join(', ') })
  if (see.inquiries && waiting.length) attention.push({ key: 'waiting', tone: 'red', to: '/inquiries', title: `${waiting.length} inquir${waiting.length === 1 ? 'y' : 'ies'} waiting over 24h for a reply`, sub: waiting.slice(0, 3).map(i => i.company_name || i.full_name).join(', ') })
  if (see.inquiries && followDue.length) attention.push({ key: 'follow', tone: 'amber', to: '/inquiries', title: `${followDue.length} inquiry follow-up${followDue.length === 1 ? '' : 's'} due`, sub: followDue.slice(0, 3).map(i => i.company_name || i.full_name).join(', ') })
  if (see.social && count(r.failed)) attention.push({ key: 'failed', tone: 'red', to: '/social/calendar', title: `${count(r.failed)} post${count(r.failed) === 1 ? '' : 's'} failed to publish`, sub: 'Open the Planner to retry' })
  if (see.approvals && count(r.approvals)) attention.push({ key: 'approvals', tone: 'amber', to: '/social/approvals', title: `${count(r.approvals)} post${count(r.approvals) === 1 ? '' : 's'} waiting for approval`, sub: 'Approve or request changes' })
  if (see.inbox && count(r.inbox)) attention.push({ key: 'inbox', tone: 'amber', to: '/social/inbox', title: `${count(r.inbox)} comment${count(r.inbox) === 1 ? '' : 's'} to answer`, sub: 'Social inbox' })

  // ── Recent activity (merged feed) ──
  const feed = []
  for (const a of ok(r.acts)) {
    const who = a.lead?.company_name || a.lead?.full_name || 'a lead'
    feed.push({ at: a.occurred_at, kind: INTERACTION_MEDIUMS.includes(a.medium) ? 'touch' : 'note', to: `/pipeline?lead=${a.lead_id}`,
      text: a.medium === 'stage' ? `${who}: ${a.summary}` : `${MEDIUM_BY_KEY[a.medium]?.label} with ${who}`, by: a.author?.name })
  }
  for (const l of leads.filter(x => inRange(x.created_at))) feed.push({ at: l.created_at, kind: 'lead', to: `/pipeline?lead=${l.id}`, text: `New lead: ${l.full_name}${l.company_name ? ` (${l.company_name})` : ''}`, by: l.entry_point === 'scoper' ? 'from the scoper' : l.entry_point === 'custom_build_form' ? 'custom build form' : 'added by staff' })
  for (const x of runs.filter(y => inRange(y.report_generated_at))) feed.push({ at: x.report_generated_at, kind: 'run', to: `/pipeline?run=${x.id}`, text: `${x.company_name} finished the scoper`, by: x.pipeline_lead_id || x.contact_requested_at ? 'asked to be contacted' : 'anonymous' })
  for (const i of inqNew.filter(y => inRange(y.received_at))) feed.push({ at: i.received_at, kind: 'inquiry', to: '/inquiries', text: `Inquiry from ${i.full_name}${i.company_name ? ` (${i.company_name})` : ''}` })
  for (const p of posted.filter(y => inRange(y.posted_at)).slice(0, 6)) feed.push({ at: p.posted_at, kind: 'post', to: '/social/calendar', text: `Published: ${(p.caption || 'a post').replace(/\s+/g, ' ').slice(0, 70)}${(p.caption || '').length > 70 ? '…' : ''}` })
  for (const o of ospod.filter(y => inRange(y.created_at)).slice(0, 5)) feed.push({ at: o.created_at, kind: 'ospod', to: '/ospod-waitlist', text: 'New Ospod waitlist signup' })
  feed.sort((a, b) => b.at.localeCompare(a.at))

  const firstName = (profile?.name || '').split(' ')[0]
  const rangeLabel = `last ${range} days`

  return (
    <div className="ov-page">
      <header className="ov-head">
        <div>
          <h1 className="page-title">{greeting(now)}{firstName ? `, ${firstName}` : ''}</h1>
          <p className="page-subtitle">{now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} · what is happening across the BMS</p>
        </div>
        <div className="ov-range" role="tablist" aria-label="Period">
          {RANGES.map(x => (
            <button key={x.key} type="button" role="tab" aria-selected={range === x.key} className={range === x.key ? 'active' : ''} onClick={() => setRange(x.key)}>{x.label}</button>
          ))}
        </div>
      </header>

      {/* Needs attention */}
      <section className="ov-attention" aria-label="Needs attention">
        {attention.length === 0 ? (
          <div className="ov-allclear"><span aria-hidden="true">✓</span> Nothing needs attention right now.</div>
        ) : attention.map(a => (
          <Link key={a.key} to={a.to} className={`ov-alert ov-alert-${a.tone}`}>
            <strong>{a.title}</strong>
            {a.sub && <span>{a.sub}</span>}
          </Link>
        ))}
      </section>

      {/* Headline numbers */}
      <section className="ov-kpis" aria-label="Headline numbers">
        {see.pipeline && <Kpi label="Scoper runs" value={runsNow} to="/pipeline" now={runsNow} before={runsPrev} sub={<>{pct(asked, runsNow)}% asked to talk · </>} />}
        {see.pipeline && <Kpi label="New leads" value={newLeadsNow} to="/pipeline" now={newLeadsNow} before={newLeadsPrev} sub={<>{active.length} active{openValue ? ` · ${money(openValue, valueCur)}` : ''} · </>} />}
        {see.pipeline && <Kpi label="Clients won" value={wonNow} to="/pipeline" now={wonNow} before={wonPrev} tone={wonNow ? 'green' : ''} sub={<>{rangeLabel} · </>} />}
        {see.inquiries && <Kpi label="Open inquiries" value={openInq.length} to="/inquiries" sub={<>{inqNew.filter(i => inRange(i.received_at)).length} new in {rangeLabel}</>} />}
        {see.social && <Kpi label="Posts published" value={postedNow} to="/social/analytics" now={postedNow} before={postedPrev} sub={<>{ok(r.upcoming).length} scheduled this week · </>} />}
        {see.web && <Kpi label="Website visits" value={visitsNow.toLocaleString('en-US')} to="/social/website-analytics" now={visitsNow} before={visitsPrev} sub={<>vs previous {range} days </>} />}
        {see.ospod && <Kpi label="Ospod signups" value={ospodNow} to="/ospod-waitlist" now={ospodNow} before={ospodPrev} sub={<>{count(r.ospodTotal) ?? 0} total · </>} />}
      </section>

      <div className="ov-grid">
        {/* Pipeline funnel */}
        {see.pipeline && (
          <section className="ov-card">
            <div className="ov-card-head"><h2>Custom builds pipeline</h2><Link to="/pipeline">Open</Link></div>
            <div className="ov-funnel">
              {[
                { label: 'Ran the scoper', n: runsNow, note: rangeLabel },
                { label: 'Active leads', n: active.length, note: stale.length ? `${stale.length} need attention` : 'all contacted', warn: stale.length > 0 },
                { label: 'Clients won', n: wonNow, note: rangeLabel },
              ].map((s, i, arr) => (
                <div key={s.label} className="ov-funnel-row">
                  <span className="ov-funnel-no">{i + 1}</span>
                  <span className="ov-funnel-label">{s.label}</span>
                  <span className="ov-funnel-bar"><i style={{ width: `${Math.max(4, (s.n / Math.max(1, ...arr.map(x => x.n))) * 100)}%` }} /></span>
                  <strong>{s.n}</strong>
                  <span className={`ov-funnel-note ${s.warn ? 'ov-red' : ''}`}>{s.note}</span>
                </div>
              ))}
            </div>
            {stale.length > 0 && (
              <ul className="ov-list">
                {stale.slice(0, 4).map(l => (
                  <li key={l.id}><Link to={`/pipeline?lead=${l.id}`}><span>{l.full_name}{l.company_name ? ` · ${l.company_name}` : ''}</span><em className="ov-red">{Math.floor(hoursQuiet(l, now))}h quiet</em></Link></li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* Website trend */}
        {see.web && (
          <section className="ov-card">
            <div className="ov-card-head"><h2>Website visits</h2><Link to="/social/website-analytics">Open</Link></div>
            <p className="ov-big">{visitsNow.toLocaleString('en-US')} <Delta now={visitsNow} before={visitsPrev} /></p>
            <Sparkbars series={visitSeries} label={`Visits per day, last ${days} days`} />
            <p className="ov-muted">Per day, last {days} days</p>
          </section>
        )}

        {/* Coming up */}
        {(see.calls || see.social) && (
          <section className="ov-card">
            <div className="ov-card-head"><h2>Coming up</h2></div>
            {see.calls && (
              <>
                <p className="ov-sub">Booked calls</p>
                {ok(r.calls).length === 0 ? <p className="ov-muted">No calls booked.</p> : (
                  <ul className="ov-list">
                    {ok(r.calls).map(c => (
                      <li key={c.id}><Link to="/leads"><span>{c.full_name}{c.company_name ? ` · ${c.company_name}` : ''}</span><em>{new Date(c.scheduled_date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}{c.scheduled_time ? ` · ${c.scheduled_time}` : ''}</em></Link></li>
                    ))}
                  </ul>
                )}
              </>
            )}
            {see.social && (
              <>
                <p className="ov-sub">Scheduled posts, next 7 days</p>
                {ok(r.upcoming).length === 0 ? <p className="ov-muted">Nothing scheduled.</p> : (
                  <ul className="ov-list">
                    {ok(r.upcoming).map(p => (
                      <li key={p.id}><Link to={`/social/composer/${p.id}`}><span>{(p.caption || 'Untitled post').replace(/\s+/g, ' ').slice(0, 60)}</span><em>{new Date(p.scheduled_at).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</em></Link></li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>
        )}

        {/* Activity feed */}
        <section className="ov-card ov-card-feed">
          <div className="ov-card-head"><h2>Recent activity</h2><span className="ov-muted">{rangeLabel}</span></div>
          {feed.length === 0 ? <p className="ov-muted">No activity in this period.</p> : (
            <ol className="ov-feed">
              {feed.slice(0, 14).map((f, i) => (
                <li key={i} className={`ov-feed-${f.kind}`}>
                  <i aria-hidden="true" />
                  <Link to={f.to}>{f.text}</Link>
                  <span>{timeAgo(f.at, now)}{f.by ? ` · ${f.by}` : ''}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  )
}
