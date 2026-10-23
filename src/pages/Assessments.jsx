import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { exportCSV } from '../lib/exportUtils'
import { shortDate, timeAgo } from '../lib/inquiries'
import { isMissingTable, kes, kesShort, progressNote, scoreTone, statusLabel, summarise, valueRange } from '../lib/gapAssessments'
import AssessmentDetail from '../components/AssessmentDetail/AssessmentDetail'
import PeriodSelector, { filterByPeriod, getPeriodLabel } from '../components/PeriodSelector/PeriodSelector'
import './AllLeads.css'
import './Inquiries.css'
import './Assessments.css'

const StatIcons = {
  done: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9.5l3.5 3.5L15 5" /></svg>,
  rate: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 14l4-5 3.5 3L16 4" /><path d="M12 4h4v4" /></svg>,
  gauge: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2.5 13a6.5 6.5 0 1 1 13 0" /><path d="M9 13l3-4" /></svg>,
  value: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="9" cy="9" r="7" /><path d="M9 5v8M6.8 7.2c0-.9.9-1.5 2.2-1.5s2.2.6 2.2 1.5c0 2.2-4.4 1-4.4 3.3 0 .9 1 1.5 2.2 1.5s2.2-.6 2.2-1.5" /></svg>,
}

// Only the columns the list needs; the full report and the internal working load when a row is opened.
const LIST_COLUMNS = [
  'id', 'status', 'full_name', 'email', 'company_name', 'website_url', 'user_turns', 'areas_covered',
  'created_at', 'last_activity_at', 'report_generated_at', 'pdf_downloaded_at', 'cta_clicked_at', 'cta_kind', 'inquiry_id',
  'readiness:report->readiness', 'roi:report->roi',
].join(',')

const VIEWS = [
  { key: 'done', label: 'Reports ready' },
  { key: 'progress', label: 'In progress' },
  { key: 'all', label: 'All' },
]

export default function Assessments() {
  const { profile } = useAuth()
  const [params, setParams] = useSearchParams()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [setupNeeded, setSetupNeeded] = useState(false)
  const [loadError, setLoadError] = useState('')

  const now = new Date()
  const [period, setPeriod] = useState({ mode: 'all', month: now.getMonth(), year: now.getFullYear() })
  const [view, setView] = useState('done')
  const [search, setSearch] = useState('')
  const [toast, setToast] = useState({ show: false, type: '', text: '' })

  const selectedId = params.get('id')

  useEffect(() => { fetchAll() }, [])
  useEffect(() => {
    if (!toast.show) return
    const timer = setTimeout(() => setToast({ show: false, type: '', text: '' }), 4000)
    return () => clearTimeout(timer)
  }, [toast.show])

  async function fetchAll() {
    const { data, error } = await supabase
      .from('gap_assessments').select(LIST_COLUMNS).order('created_at', { ascending: false }).limit(1000)
    if (error) {
      if (isMissingTable(error)) setSetupNeeded(true)
      else setLoadError(error.message || 'Could not load the assessments.')
    } else {
      setRows(data || [])
    }
    setLoading(false)
  }

  function select(id) {
    const next = new URLSearchParams(params)
    if (id) next.set('id', id)
    else next.delete('id')
    setParams(next, { replace: true })
  }

  async function handleDeleted(id) {
    setRows(prev => prev.filter(r => r.id !== id))
    select(null)
    setToast({ show: true, type: 'success', text: 'Assessment deleted' })
  }

  const inPeriod = filterByPeriod(rows, period, 'created_at')
  const stats = summarise(inPeriod)
  const counts = { done: inPeriod.filter(r => r.status === 'report_ready').length, progress: inPeriod.filter(r => r.status !== 'report_ready').length, all: inPeriod.length }

  const filtered = useMemo(() => inPeriod
    .filter(r => view === 'all' || (view === 'done' ? r.status === 'report_ready' : r.status !== 'report_ready'))
    .filter(r => {
      const q = search.trim().toLowerCase()
      if (!q) return true
      return [r.full_name, r.company_name, r.email, r.website_url].some(v => v && v.toLowerCase().includes(q))
    }), [inPeriod, view, search])

  function handleExportCSV() {
    const headers = ['Started', 'Name', 'Company', 'Email', 'Website', 'Status', 'Replies', 'Readiness', 'Currency', 'Value low', 'Value likely', 'Value high', 'Value likely (KES)', 'PDF downloaded', 'Asked for more']
    const data = filtered.map(r => [
      r.created_at ? new Date(r.created_at).toLocaleString('en-GB') : '', r.full_name, r.company_name, r.email, r.website_url,
      statusLabel(r.status), r.user_turns, r.readiness?.score ?? '',
      r.roi ? (r.roi.currency || 'KES') : '', r.roi?.annual_low ?? '', r.roi?.annual_expected ?? '', r.roi?.annual_high ?? '', r.roi?.annual_expected_kes ?? r.roi?.annual_expected ?? '',
      r.pdf_downloaded_at ? 'Yes' : '', r.cta_clicked_at ? 'Yes' : '',
    ])
    exportCSV(headers, data, `SDFM_Automation_Scoper_${new Date().toISOString().slice(0, 10)}`)
  }

  if (loading) {
    return (
      <div>
        <div className="page-header"><h1 className="page-title">Automation Scoper</h1></div>
        <div className="section-card">{[1, 2, 3].map(i => <div key={i} className="skeleton skeleton-bar" style={{ width: `${100 - i * 15}%` }} />)}</div>
      </div>
    )
  }

  if (setupNeeded) {
    return (
      <div>
        <div className="page-header"><h1 className="page-title">Automation Scoper</h1></div>
        <div className="section-card inq-setup">
          <h2 className="section-card-title">One-time database setup needed</h2>
          <p>
            The Automation scoper needs two new tables. In the Supabase SQL Editor, run <code>supabase/migration-gap-assessments.sql</code>
            {' '}(it is safe to run again), then reload this page. The tool itself is the <code>gap-assessment</code> Edge Function; see the README for deploying it.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="inq-page ga-page">
      <div className="page-header leads-header">
        <div>
          <h1 className="page-title">Automation Scoper</h1>
          <p className="page-subtitle">Visitors who used the free assessment tool on the website · {getPeriodLabel(period)}</p>
        </div>
        <div className="leads-header-actions">
          <PeriodSelector value={period} onChange={setPeriod} />
          {rows.length > 0 && (
            <>
              <div className="leads-search-wrap">
                <svg className="leads-search-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="7" cy="7" r="5" /><path d="M11 11l3.5 3.5" /></svg>
                <input type="text" className="leads-search" placeholder="Search name, company, email..." value={search} onChange={e => setSearch(e.target.value)} aria-label="Search assessments" />
              </div>
              <div className="leads-export-btns">
                <button className="btn btn-secondary btn-sm" onClick={handleExportCSV}>CSV</button>
              </div>
            </>
          )}
        </div>
      </div>

      {loadError && <div className="inq-banner inq-banner-error">{loadError}</div>}

      <div className="inq-stats-row">
        <div className="stat-card stat-card-accent">
          <div className="stat-icon">{StatIcons.done}</div>
          <div className="stat-label">Reports delivered</div>
          <div className="stat-value">{stats.completed}</div>
          <div className="inq-stat-sub">{stats.started} started</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">{StatIcons.rate}</div>
          <div className="stat-label">Finish rate</div>
          <div className="stat-value">{stats.completionRate}%</div>
          <div className="inq-stat-sub">{stats.pdfs} downloaded the PDF · {stats.asked} asked for more</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">{StatIcons.gauge}</div>
          <div className="stat-label">Average readiness</div>
          <div className="stat-value">{stats.avgReadiness ?? '—'}{stats.avgReadiness != null && <span className="ga-of">/100</span>}</div>
          <div className="inq-stat-sub">Across finished reports</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">{StatIcons.value}</div>
          <div className="stat-label">Value surfaced</div>
          <div className="stat-value">{kesShort(stats.value)}</div>
          <div className="inq-stat-sub">Most likely, per year, all reports</div>
        </div>
      </div>

      <div className="inq-views" role="tablist" aria-label="Assessment views">
        {VIEWS.map(v => (
          <button key={v.key} role="tab" aria-selected={view === v.key} className={`inq-view-tab ${view === v.key ? 'active' : ''}`} onClick={() => setView(v.key)}>
            {v.label} <span className="inq-view-count">{counts[v.key]}</span>
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="section-card">
          <div className="empty-state">
            <div className="empty-state-title">No assessments yet</div>
            <p className="empty-state-desc">When a visitor completes the Automation scoper at sdfmgroup.com/ai-gap-check, their report, conversation and projected ROI appear here, and an inquiry is created for follow-up.</p>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="section-card">
          <div className="empty-state">
            <div className="empty-state-title">No assessments match</div>
            <p className="empty-state-desc">Try another view or clear the search.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="leads-table-wrap section-card">
            <table className="data-table">
              <thead>
                <tr><th>Who</th><th>Status</th><th>Readiness</th><th>Projected value / year</th><th>Follow-up</th><th>Started</th></tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id} className="leads-row-clickable" onClick={() => select(r.id)}>
                    <td>
                      <button className="inq-row-link" onClick={e => { e.stopPropagation(); select(r.id) }}>
                        <span className="leads-name">{r.company_name}</span>
                        <span className="inq-sub">{r.full_name}</span>
                      </button>
                    </td>
                    <td>
                      {r.status === 'report_ready'
                        ? <span className="inq-status inq-status-converted">Report ready</span>
                        : <><span className="inq-status inq-status-contacted">In progress</span><div className="inq-sub ga-sub">{progressNote(r)}</div></>}
                    </td>
                    <td>{r.readiness ? <span className={`ga-score ga-score-${scoreTone(r.readiness.score)}`}>{r.readiness.score}</span> : <span className="inq-sub">—</span>}</td>
                    <td className="inq-muted">{valueRange(r.roi) || <span className="inq-sub">—</span>}</td>
                    <td>
                      <div className="inq-next">
                        {r.pdf_downloaded_at && <span className="ga-chip">PDF</span>}
                        {r.cta_clicked_at && <span className="ga-chip ga-chip-hot">Asked for more</span>}
                        {r.inquiry_id && !r.pdf_downloaded_at && !r.cta_clicked_at && <span className="inq-sub">Inquiry logged</span>}
                        {!r.inquiry_id && !r.pdf_downloaded_at && !r.cta_clicked_at && <span className="inq-sub">—</span>}
                      </div>
                    </td>
                    <td className="inq-muted" title={shortDate(r.created_at)}>{timeAgo(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="leads-mobile-list">
            {filtered.map(r => (
              <div key={r.id} className="leads-mobile-card leads-row-clickable" onClick={() => select(r.id)}>
                <div className="leads-mobile-card-top">
                  <div>
                    <div className="leads-mobile-name">{r.company_name}</div>
                    <div className="leads-mobile-company">{r.full_name}</div>
                  </div>
                  {r.status === 'report_ready'
                    ? <span className="inq-status inq-status-converted">Report ready</span>
                    : <span className="inq-status inq-status-contacted">In progress</span>}
                </div>
                <div className="leads-mobile-card-bottom">
                  <span className="leads-mobile-meta"><span className="leads-mobile-label">Readiness</span>{r.readiness?.score ?? '—'}</span>
                  <span className="leads-mobile-meta"><span className="leads-mobile-label">Value</span>{valueRange(r.roi) || '—'}</span>
                  <span className="leads-mobile-meta"><span className="leads-mobile-label">Started</span>{timeAgo(r.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {selectedId && (
        <AssessmentDetail
          id={selectedId}
          isAdmin={profile?.role === 'admin'}
          onClose={() => select(null)}
          onDeleted={handleDeleted}
        />
      )}

      {toast.show && <div className={`toast toast-${toast.type}`}>{toast.text}</div>}
    </div>
  )
}
