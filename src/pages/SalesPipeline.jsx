import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import {
  SERVICE_LINES, STAGES, SOURCES, SOURCE_BY_KEY, MEDIUM_BY_KEY, INTERACTION_MEDIUMS, STALE_AFTER_HOURS,
  classifySource, isStale, hoursQuiet, hoursUntilStale, timeAgo, money, initials, pct,
} from '../lib/pipeline'
import PeriodSelector, { filterByPeriod } from '../components/PeriodSelector/PeriodSelector'
import PipelineLeadDrawer from '../components/PipelineLeadDrawer/PipelineLeadDrawer'
import ScoperRunDrawer from '../components/PipelineLeadDrawer/ScoperRunDrawer'
import { AddLeadModal } from '../components/PipelineLeadDrawer/PipelineModals'
import './SalesPipeline.css'

const RUN_COLUMNS = [
  'id', 'status', 'company_name', 'full_name', 'email', 'phone', 'website_url', 'created_at', 'report_generated_at',
  'user_turns', 'source_channel', 'utm_source', 'utm_medium', 'referrer', 'page_url', 'heard_from',
  'pipeline_lead_id', 'contact_requested_at', 'pdf_downloaded_at',
  'readiness:report->readiness', 'roi:report->roi',
].join(',')

function SourceChip({ source }) {
  const s = SOURCE_BY_KEY[source] || SOURCE_BY_KEY.other
  return <span className="pl-source" style={{ '--src': s.color }}><i aria-hidden="true" />{s.short}</span>
}

function FlagIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><path d="M2 1h1v10H2zM3.5 1.5h6l-1.5 2.25L9.5 6h-6z" /></svg>
}

export default function SalesPipeline() {
  const { profile, can } = useAuth()
  const [params, setParams] = useSearchParams()
  const [leads, setLeads] = useState([])
  const [runs, setRuns] = useState([])
  const [team, setTeam] = useState([])
  const [lastTouch, setLastTouch] = useState({})
  const [loading, setLoading] = useState(true)
  const [setupMissing, setSetupMissing] = useState(false)
  const [now, setNow] = useState(() => new Date())

  const today = new Date()
  const [period, setPeriod] = useState({ mode: 'all', month: today.getMonth(), year: today.getFullYear() })
  const [search, setSearch] = useState('')
  const [source, setSource] = useState('all')
  const [attentionOnly, setAttentionOnly] = useState(params.get('filter') === 'attention')
  const [showLost, setShowLost] = useState(false)
  const [mobileStage, setMobileStage] = useState('active')

  const [dragId, setDragId] = useState(null)
  const [dragOver, setDragOver] = useState(null)
  const [adding, setAdding] = useState(false)
  const [toast, setToast] = useState(null)

  const openLeadId = params.get('lead')
  const openRunId = params.get('run')

  useEffect(() => { load() }, [])
  // Keep "2h ago" and the 48-hour flags honest while the page stays open.
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t) }, [])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t) }, [toast])

  async function load() {
    const [leadRes, runRes, teamRes, actRes] = await Promise.all([
      supabase.from('pipeline_leads').select('*').eq('service_line', 'custom_build').order('created_at', { ascending: false }),
      supabase.from('gap_assessments').select(RUN_COLUMNS).order('created_at', { ascending: false }).limit(500),
      supabase.from('profiles').select('id, name, role, is_active').in('role', ['admin', 'sales']).order('name'),
      supabase.from('pipeline_activities').select('lead_id, medium, occurred_at').in('medium', INTERACTION_MEDIUMS).order('occurred_at', { ascending: false }).limit(1000),
    ])
    if (leadRes.error && /pipeline_leads|schema cache|does not exist/i.test(leadRes.error.message || '')) {
      setSetupMissing(true)
      setLoading(false)
      return
    }
    setLeads(leadRes.data || [])
    setRuns(runRes.data || [])
    setTeam((teamRes.data || []).filter(p => p.is_active !== false))
    const latest = {}
    for (const a of actRes.data || []) if (!latest[a.lead_id]) latest[a.lead_id] = a
    setLastTouch(latest)
    setLoading(false)
  }

  function openLead(id) { const p = new URLSearchParams(params); p.delete('run'); p.set('lead', id); setParams(p, { replace: true }) }
  function openRun(id) { const p = new URLSearchParams(params); p.delete('lead'); p.set('run', id); setParams(p, { replace: true }) }
  function closeDrawer() { const p = new URLSearchParams(params); p.delete('lead'); p.delete('run'); setParams(p, { replace: true }) }

  // A lead changed in the drawer (stage, owner, an interaction): patch it in place.
  function onLeadChanged(updated, touch) {
    if (updated === null) { setLeads(prev => prev.filter(l => l.id !== openLeadId)); closeDrawer(); return }
    setLeads(prev => prev.some(l => l.id === updated.id) ? prev.map(l => (l.id === updated.id ? { ...l, ...updated } : l)) : [updated, ...prev])
    if (touch) setLastTouch(prev => ({ ...prev, [updated.id]: touch }))
  }

  async function moveStage(lead, stage) {
    if (lead.stage === stage) return
    const prevStage = lead.stage
    setLeads(prev => prev.map(l => (l.id === lead.id ? { ...l, stage } : l)))
    const { data, error } = await supabase.from('pipeline_leads').update({ stage }).eq('id', lead.id).select('*').single()
    if (error) {
      setLeads(prev => prev.map(l => (l.id === lead.id ? { ...l, stage: prevStage } : l)))
      setToast({ type: 'error', text: `Could not move ${lead.full_name}: ${error.message}` })
      return
    }
    setLeads(prev => prev.map(l => (l.id === lead.id ? data : l)))
    await supabase.from('pipeline_activities').insert({
      lead_id: lead.id, medium: 'stage', created_by: profile?.id,
      summary: stage === 'client' ? 'Marked as a client' : stage === 'active' ? 'Moved back to active leads' : 'Marked as lost',
    })
    setToast({ type: 'success', text: stage === 'client' ? `${lead.full_name} is now a client 🎉` : `${lead.full_name} moved to active leads` })
  }

  // ── Derived data ───────────────────────────────────────────────────
  const q = search.trim().toLowerCase()
  const matches = (...vals) => !q || vals.some(v => v && String(v).toLowerCase().includes(q))

  const runsInPeriod = useMemo(() => filterByPeriod(runs, period), [runs, period])
  const leadsInPeriod = useMemo(() => filterByPeriod(leads, period), [leads, period])
  const clientsInPeriod = useMemo(() => filterByPeriod(leads.filter(l => l.stage === 'client'), period, 'won_at'), [leads, period])

  const runSource = r => classifySource(r)
  const scoperCol = runsInPeriod
    .filter(r => !r.pipeline_lead_id && !r.contact_requested_at)
    .filter(r => source === 'all' || runSource(r) === source)
    .filter(r => matches(r.company_name, r.full_name, r.email))
  const activeAll = leads.filter(l => l.stage === 'active')
  const staleCount = activeAll.filter(l => isStale(l, now)).length
  const activeCol = leadsInPeriod
    .filter(l => l.stage === 'active' || (showLost && l.stage === 'lost'))
    .filter(l => source === 'all' || l.source_channel === source)
    .filter(l => !attentionOnly || isStale(l, now))
    .filter(l => matches(l.full_name, l.company_name, l.email, l.phone))
    .sort((a, b) => (isStale(b, now) - isStale(a, now)) || (hoursQuiet(b, now) - hoursQuiet(a, now)))
  const clientCol = clientsInPeriod
    .filter(l => source === 'all' || l.source_channel === source)
    .filter(l => matches(l.full_name, l.company_name, l.email))
    .sort((a, b) => (b.won_at || '').localeCompare(a.won_at || ''))

  // Funnel for the period: runs → asked to talk; all leads → clients.
  const runsTotal = runsInPeriod.length
  const runsConverted = runsInPeriod.filter(r => r.pipeline_lead_id || r.contact_requested_at).length
  // Win rate: of the leads that arrived in the period, how many are clients now.
  const leadsTotal = leadsInPeriod.length
  const leadsWon = leadsInPeriod.filter(l => l.stage === 'client').length
  const clientsTotal = clientsInPeriod.length
  const activeValue = activeAll.reduce((s, l) => s + (Number(l.estimated_value) || 0), 0)
  const valueCurrency = activeAll.find(l => l.estimated_value)?.currency || 'KES'

  // Where everyone came from (all three stages, period), for the source bar.
  const sourceMix = useMemo(() => {
    const counts = Object.fromEntries(SOURCES.map(s => [s.key, 0]))
    runsInPeriod.filter(r => !r.pipeline_lead_id).forEach(r => { counts[runSource(r)]++ })
    leadsInPeriod.forEach(l => { counts[l.source_channel] = (counts[l.source_channel] || 0) + 1 })
    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    return { counts, total }
  }, [runsInPeriod, leadsInPeriod])

  const openLeadRow = leads.find(l => l.id === openLeadId) || null
  const openRunRow = runs.find(r => r.id === openRunId) || null
  const canEdit = can('pipeline')

  // ── Drag and drop (active ⇄ client) ────────────────────────────────
  function onDragStart(e, lead) { setDragId(lead.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', lead.id) }
  function onDrop(e, stage) {
    e.preventDefault(); setDragOver(null)
    const lead = leads.find(l => l.id === dragId)
    setDragId(null)
    if (lead && stage !== 'scoper') moveStage(lead, stage)
  }
  const dropProps = stage => (stage === 'scoper' || !canEdit) ? {} : {
    onDragOver: e => { e.preventDefault(); setDragOver(stage) },
    onDragLeave: () => setDragOver(null),
    onDrop: e => onDrop(e, stage),
  }

  // ── Cards ──────────────────────────────────────────────────────────
  function RunCard({ r }) {
    const ready = r.status === 'report_ready'
    const value = r.roi?.quantified_gaps ? money(r.roi.annual_expected, r.roi.currency) : ''
    return (
      <button type="button" className="pl-card pl-card-run" onClick={() => openRun(r.id)}>
        <div className="pl-card-top">
          <span className="pl-card-title">{r.company_name}</span>
          <span className="pl-card-time">{timeAgo(r.created_at, now)}</span>
        </div>
        <div className="pl-card-line">
          <span className={`pl-dot ${ready ? 'pl-dot-ok' : 'pl-dot-wait'}`} aria-hidden="true" />
          {ready ? `Report ready${r.readiness?.score != null ? ` · ${r.readiness.score}/100` : ''}` : `In progress · ${r.user_turns || 0} replies`}
        </div>
        <div className="pl-card-foot">
          <SourceChip source={runSource(r)} />
          {value && <span className="pl-card-value" title="Projected yearly value from the report">{value}/yr</span>}
          {r.full_name && <span className="pl-tag">Has contact</span>}
        </div>
      </button>
    )
  }

  function LeadCard({ l }) {
    const stale = isStale(l, now)
    const touch = lastTouch[l.id]
    const owner = team.find(t => t.id === l.owner_id)
    const lost = l.stage === 'lost'
    let status
    if (lost) status = <span className="pl-card-muted">Lost{l.lost_reason ? ` · ${l.lost_reason}` : ''}</span>
    else if (stale) status = <span className="pl-stale"><FlagIcon />{Math.floor(hoursQuiet(l, now))}h with no contact</span>
    else if (touch) status = <span className="pl-card-muted">{MEDIUM_BY_KEY[touch.medium]?.verb} {timeAgo(touch.occurred_at, now)}</span>
    else status = <span className="pl-due">Not contacted yet · {Math.ceil(hoursUntilStale(l, now))}h left</span>
    return (
      <div
        role="button"
        tabIndex={0}
        className={`pl-card pl-card-lead ${stale ? 'is-stale' : ''} ${lost ? 'is-lost' : ''} ${dragId === l.id ? 'is-dragging' : ''}`}
        draggable={canEdit && !lost}
        onDragStart={e => onDragStart(e, l)}
        onDragEnd={() => { setDragId(null); setDragOver(null) }}
        onClick={() => openLead(l.id)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLead(l.id) } }}
      >
        <div className="pl-card-top">
          <span className="pl-avatar" aria-hidden="true">{initials(l.full_name)}</span>
          <div className="pl-card-who">
            <span className="pl-card-title">{l.full_name}</span>
            {l.company_name && <span className="pl-card-sub">{l.company_name}</span>}
          </div>
          {owner && <span className="pl-owner" title={`Owner: ${owner.name}`}>{initials(owner.name)}</span>}
        </div>
        <div className="pl-card-line">{status}</div>
        <div className="pl-card-foot">
          <SourceChip source={l.source_channel} />
          {l.entry_point === 'scoper' && <span className="pl-tag">Scoper</span>}
          {l.entry_point === 'custom_build_form' && <span className="pl-tag">Form</span>}
          {l.estimated_value && <span className="pl-card-value">{money(l.estimated_value, l.currency)}</span>}
        </div>
      </div>
    )
  }

  function ClientCard({ l }) {
    return (
      <div role="button" tabIndex={0} className={`pl-card pl-card-client ${dragId === l.id ? 'is-dragging' : ''}`}
        draggable={canEdit} onDragStart={e => onDragStart(e, l)} onDragEnd={() => { setDragId(null); setDragOver(null) }}
        onClick={() => openLead(l.id)} onKeyDown={e => { if (e.key === 'Enter') openLead(l.id) }}>
        <div className="pl-card-top">
          <span className="pl-avatar pl-avatar-won" aria-hidden="true">{initials(l.full_name)}</span>
          <div className="pl-card-who">
            <span className="pl-card-title">{l.full_name}</span>
            {l.company_name && <span className="pl-card-sub">{l.company_name}</span>}
          </div>
        </div>
        <div className="pl-card-foot">
          <span className="pl-card-muted">Won {l.won_at ? new Date(l.won_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''}</span>
          {l.estimated_value && <span className="pl-card-value">{money(l.estimated_value, l.currency)}</span>}
        </div>
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────
  if (setupMissing) {
    return (
      <div className="pl-page">
        <div className="section-card pl-setup">
          <h1 className="page-title">Sales pipeline</h1>
          <p className="page-subtitle">The pipeline tables are not set up yet. Run <code>supabase/migration-sales-pipeline.sql</code> and reload.</p>
        </div>
      </div>
    )
  }

  const columns = [
    { stage: STAGES[0], count: scoperCol.length, body: scoperCol.map(r => <RunCard key={r.id} r={r} />), empty: 'No scoper runs waiting. Visitors who run the scoper appear here until they ask to be contacted.' },
    { stage: STAGES[1], count: activeCol.filter(l => l.stage === 'active').length, extra: staleCount ? <span className="pl-col-flag"><FlagIcon />{staleCount}</span> : null, body: activeCol.map(l => <LeadCard key={l.id} l={l} />), empty: attentionOnly ? `Nothing needs attention. Every active lead has been contacted in the last ${STALE_AFTER_HOURS} hours.` : 'No active leads. They arrive from the scoper, the custom build form, or Add lead.' },
    { stage: STAGES[2], count: clientCol.length, body: clientCol.map(l => <ClientCard key={l.id} l={l} />), empty: 'No clients in this period yet. Drag an active lead here when it converts.' },
  ]

  return (
    <div className="pl-page">
      <header className="pl-header">
        <div>
          <h1 className="page-title">Sales pipeline</h1>
          <div className="pl-lines" role="tablist" aria-label="Service line">
            {SERVICE_LINES.map(s => (
              <button key={s.key} type="button" role="tab" aria-selected={s.key === 'custom_build'} disabled={!s.live}
                className={`pl-line ${s.key === 'custom_build' ? 'active' : ''}`} title={s.note || ''}>
                {s.label}{!s.live && <span className="pl-soon">Soon</span>}
              </button>
            ))}
          </div>
        </div>
        <div className="pl-header-actions">
          <PeriodSelector value={period} onChange={setPeriod} />
          {canEdit && <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>+ Add lead</button>}
        </div>
      </header>

      {/* Funnel: three stages and the conversion between them */}
      <section className="pl-funnel" aria-label="Pipeline summary">
        <div className="pl-funnel-step">
          <span className="pl-step-no">1</span>
          <div><span className="pl-funnel-label">Ran the scoper</span><strong className="pl-funnel-num">{runsTotal}</strong></div>
        </div>
        <div className="pl-funnel-arrow" title="Share of scoper runs that asked to be contacted"><span>{pct(runsConverted, runsTotal)}%</span>asked to talk</div>
        <div className="pl-funnel-step">
          <span className="pl-step-no">2</span>
          <div>
            <span className="pl-funnel-label">Active leads</span>
            <strong className="pl-funnel-num">{activeAll.length}</strong>
            <span className="pl-funnel-sub">
              {staleCount > 0
                ? <button type="button" className="pl-linkish pl-stale" onClick={() => setAttentionOnly(true)}><FlagIcon />{staleCount} need{staleCount === 1 ? 's' : ''} attention</button>
                : 'All contacted in the last 48h'}
              {activeValue > 0 && <> · {money(activeValue, valueCurrency)} open</>}
            </span>
          </div>
        </div>
        <div className="pl-funnel-arrow" title="Share of the leads that arrived in this period that are now clients"><span>{pct(leadsWon, leadsTotal)}%</span>won</div>
        <div className="pl-funnel-step pl-funnel-won">
          <span className="pl-step-no">3</span>
          <div><span className="pl-funnel-label">Clients</span><strong className="pl-funnel-num">{clientsTotal}</strong></div>
        </div>
        {sourceMix.total > 0 && (
          <div className="pl-mix" aria-label="Where they came from">
            <div className="pl-mix-bar">
              {SOURCES.filter(s => sourceMix.counts[s.key]).map(s => (
                <span key={s.key} style={{ width: `${(sourceMix.counts[s.key] / sourceMix.total) * 100}%`, background: s.color }} title={`${s.label}: ${sourceMix.counts[s.key]}`} />
              ))}
            </div>
            <div className="pl-mix-legend">
              {SOURCES.filter(s => sourceMix.counts[s.key]).map(s => (
                <button type="button" key={s.key} className={`pl-mix-item ${source === s.key ? 'active' : ''}`} onClick={() => setSource(source === s.key ? 'all' : s.key)}>
                  <i style={{ background: s.color }} />{s.label} <b>{sourceMix.counts[s.key]}</b>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Filters */}
      <div className="pl-toolbar">
        <div className="pl-search">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><circle cx="7" cy="7" r="5" /><path d="M11 11l3.5 3.5" /></svg>
          <input type="search" placeholder="Search name, company, email or phone" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search the pipeline" />
        </div>
        <select className="form-input pl-select" value={source} onChange={e => setSource(e.target.value)} aria-label="Source">
          <option value="all">All sources</option>
          {SOURCES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <label className={`pl-toggle ${attentionOnly ? 'on' : ''}`}>
          <input type="checkbox" checked={attentionOnly} onChange={e => setAttentionOnly(e.target.checked)} />
          <FlagIcon /> Needs attention{staleCount ? ` (${staleCount})` : ''}
        </label>
        <label className={`pl-toggle ${showLost ? 'on' : ''}`}>
          <input type="checkbox" checked={showLost} onChange={e => setShowLost(e.target.checked)} />
          Show lost
        </label>
      </div>

      {/* Mobile: one stage at a time */}
      <div className="pl-mobile-tabs" role="tablist" aria-label="Stage">
        {columns.map(c => (
          <button key={c.stage.key} type="button" role="tab" aria-selected={mobileStage === c.stage.key}
            className={mobileStage === c.stage.key ? 'active' : ''} onClick={() => setMobileStage(c.stage.key)}>
            {c.stage.short} <span>{c.count}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="pl-board">{[0, 1, 2].map(i => <div key={i} className="pl-col"><div className="skeleton" style={{ height: 120, borderRadius: 10 }} /></div>)}</div>
      ) : (
        <div className="pl-board">
          {columns.map(c => (
            <section key={c.stage.key}
              className={`pl-col pl-col-${c.stage.key} ${dragOver === c.stage.key ? 'is-over' : ''} ${mobileStage === c.stage.key ? 'is-mobile-active' : ''}`}
              aria-label={c.stage.label} {...dropProps(c.stage.key)}>
              <div className="pl-col-head">
                <span className="pl-step-no">{c.stage.step}</span>
                <h2 className="pl-col-title">{c.stage.label}</h2>
                <span className="pl-col-count">{c.count}</span>
                {c.extra}
              </div>
              <p className="pl-col-hint">{c.stage.hint}</p>
              <div className="pl-col-body">
                {c.body.length ? c.body : <p className="pl-empty">{c.empty}</p>}
              </div>
            </section>
          ))}
        </div>
      )}

      {openLeadRow && (
        <PipelineLeadDrawer key={openLeadRow.id} lead={openLeadRow} team={team} canEdit={canEdit}
          isAdmin={profile?.role === 'admin'} onClose={closeDrawer} onChanged={onLeadChanged} onToast={setToast} />
      )}
      {openRunRow && (
        <ScoperRunDrawer run={openRunRow} canEdit={canEdit} onClose={closeDrawer}
          onPromoted={(lead) => { setRuns(prev => prev.map(r => (r.id === openRunRow.id ? { ...r, pipeline_lead_id: lead.id } : r))); onLeadChanged(lead); openLead(lead.id); setToast({ type: 'success', text: `${lead.full_name} is now an active lead` }) }}
          onToast={setToast} />
      )}
      {adding && (
        <AddLeadModal team={team} onClose={() => setAdding(false)}
          onSaved={lead => { setAdding(false); onLeadChanged(lead); openLead(lead.id); setToast({ type: 'success', text: `${lead.full_name} added to active leads` }) }} />
      )}

      {toast && <div className={`toast toast-${toast.type}`} role="status">{toast.text}</div>}
    </div>
  )
}
