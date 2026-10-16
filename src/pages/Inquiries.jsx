import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { exportCSV } from '../lib/exportUtils'
import {
  CHANNELS, attentionReasons, byChannel, channelLabel, closeReasonLabel, formatDays, formatMinutes,
  isMissingTable, isOpen, shortDate, shortDay, statusLabel, summarise, timeAgo,
} from '../lib/inquiries'
import InquiryDetail from '../components/InquiryDetail/InquiryDetail'
import { LogInquiryModal, ConvertInquiryModal, CloseInquiryModal } from '../components/InquiryModals/InquiryModals'
import PeriodSelector, { filterByPeriod, getPeriodLabel } from '../components/PeriodSelector/PeriodSelector'
import './AllLeads.css'
import './Inquiries.css'

const StatIcons = {
  open: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 10.5h4l1 2h4l1-2h4" /><path d="M3.5 3h11l1.5 7.5V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-3.5L3.5 3z" /></svg>,
  attention: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="9" cy="9" r="7" /><path d="M9 5v4.5M9 12v.5" /></svg>,
  rate: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 14l4-5 3.5 3L16 4" /><path d="M12 4h4v4" /></svg>,
  clock: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="9" cy="9" r="7" /><path d="M9 5v4l2.5 1.5" /></svg>,
}

const VIEWS = [
  { key: 'attention', label: 'Needs attention' },
  { key: 'open', label: 'Open' },
  { key: 'converted', label: 'Converted' },
  { key: 'closed', label: 'Closed' },
  { key: 'all', label: 'All' },
]

function matchesView(inq, view) {
  switch (view) {
    case 'attention': return isOpen(inq) && attentionReasons(inq).length > 0
    case 'open': return isOpen(inq)
    case 'converted': return inq.status === 'converted'
    case 'closed': return inq.status === 'closed'
    default: return true
  }
}

export default function Inquiries() {
  const { profile } = useAuth()
  const [inquiries, setInquiries] = useState([])
  const [team, setTeam] = useState([])
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [setupNeeded, setSetupNeeded] = useState(false)
  const [loadError, setLoadError] = useState('')

  const now = new Date()
  const [period, setPeriod] = useState({ mode: 'all', month: now.getMonth(), year: now.getFullYear() })
  const [view, setView] = useState('open')
  const [viewChosen, setViewChosen] = useState(false)
  const [search, setSearch] = useState('')
  const [filterChannel, setFilterChannel] = useState('')
  const [filterOwner, setFilterOwner] = useState('')

  const [selectedId, setSelectedId] = useState(null)
  const [showLog, setShowLog] = useState(false)
  const [convertTarget, setConvertTarget] = useState(null)
  const [closeTarget, setCloseTarget] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [toast, setToast] = useState({ show: false, type: '', text: '' })

  useEffect(() => { fetchAll() }, [])
  useEffect(() => {
    if (!toast.show) return
    const timer = setTimeout(() => setToast({ show: false, type: '', text: '' }), 4000)
    return () => clearTimeout(timer)
  }, [toast.show])

  function showToast(type, text) { setToast({ show: true, type, text }) }

  async function fetchAll() {
    const [inqRes, teamRes, leadsRes] = await Promise.all([
      supabase.from('inquiries').select('*').order('received_at', { ascending: false }),
      supabase.from('profiles').select('id, name, role').in('role', ['admin', 'sales']).order('name'),
      supabase.from('leads').select('id, full_name, company_name, email, phone, current_stage, is_lost').order('created_at', { ascending: false }),
    ])
    if (inqRes.error) {
      if (isMissingTable(inqRes.error)) setSetupNeeded(true)
      else setLoadError(inqRes.error.message || 'Could not load inquiries.')
    } else {
      setInquiries(inqRes.data || [])
    }
    setTeam(teamRes.data || [])
    setLeads(leadsRes.data || [])
    setLoading(false)
  }

  // Open on "Needs attention" when something does, otherwise on every open inquiry, unless the user already chose.
  useEffect(() => {
    if (loading || viewChosen) return
    setView(inquiries.some(i => isOpen(i) && attentionReasons(i).length > 0) ? 'attention' : 'open')
  }, [loading, inquiries, viewChosen])

  function replaceInquiry(updated) {
    setInquiries(prev => prev.map(i => (i.id === updated.id ? updated : i)))
  }

  async function refreshAfterChange(id) {
    const [inqRes, leadsRes] = await Promise.all([
      supabase.from('inquiries').select('*').eq('id', id).single(),
      supabase.from('leads').select('id, full_name, company_name, email, phone, current_stage, is_lost').order('created_at', { ascending: false }),
    ])
    if (inqRes.data) replaceInquiry(inqRes.data)
    if (leadsRes.data) setLeads(leadsRes.data)
  }

  async function handleConverted(leadId, message) {
    const id = convertTarget.id
    setConvertTarget(null)
    await refreshAfterChange(id)
    showToast('success', message)
  }

  async function handleClosed(message) {
    const id = closeTarget.id
    setCloseTarget(null)
    await refreshAfterChange(id)
    showToast('success', message)
  }

  async function handleConfirmDelete() {
    setDeleting(true)
    const { error } = await supabase.from('inquiries').delete().eq('id', deleteTarget.id)
    setDeleting(false)
    if (error) return showToast('error', error.message || 'Could not delete the inquiry')
    setInquiries(prev => prev.filter(i => i.id !== deleteTarget.id))
    if (selectedId === deleteTarget.id) setSelectedId(null)
    setDeleteTarget(null)
    showToast('success', 'Inquiry deleted')
  }

  const teamById = useMemo(() => new Map(team.map(t => [t.id, t])), [team])

  // The reporting numbers follow the period (by the date the inquiry came in); the open / attention
  // counts and the work list are about right now, so they ignore it.
  const inPeriod = filterByPeriod(inquiries, period, 'received_at')
  const stats = summarise(inPeriod)
  const channelRows = byChannel(inPeriod)
  const openNow = inquiries.filter(isOpen)
  const attentionNow = openNow.filter(i => attentionReasons(i).length > 0)
  const followUpsDue = openNow.filter(i => attentionReasons(i).includes('Follow-up due')).length
  const repliesOverdue = openNow.filter(i => attentionReasons(i).includes('Reply overdue')).length

  const listBase = view === 'converted' || view === 'closed' || view === 'all' ? inPeriod : inquiries
  const filtered = listBase
    .filter(i => matchesView(i, view))
    .filter(i => !filterChannel || i.channel === filterChannel)
    .filter(i => {
      if (!filterOwner) return true
      if (filterOwner === 'mine') return i.assigned_to === profile?.id
      if (filterOwner === 'none') return !i.assigned_to
      return i.assigned_to === filterOwner
    })
    .filter(i => {
      const q = search.trim().toLowerCase()
      if (!q) return true
      return [i.full_name, i.company_name, i.email, i.phone, i.message].some(v => v && v.toLowerCase().includes(q))
    })
    .map(i => ({ inq: i, reasons: isOpen(i) ? attentionReasons(i) : [] }))
    .sort((a, b) => b.reasons.length - a.reasons.length || new Date(b.inq.received_at) - new Date(a.inq.received_at))

  const viewCounts = {
    attention: attentionNow.length,
    open: openNow.length,
    converted: inPeriod.filter(i => i.status === 'converted').length,
    closed: inPeriod.filter(i => i.status === 'closed').length,
    all: inPeriod.length,
  }

  const selected = inquiries.find(i => i.id === selectedId) || null
  const hasFilters = filterChannel || filterOwner || search.trim()

  function handleExportCSV() {
    const headers = ['Received', 'Name', 'Company', 'Email', 'Phone', 'Channel', 'Detail', 'Status', 'Closed reason', 'Owner', 'First reply (min)', 'Next follow-up', 'Message']
    const rows = filtered.map(({ inq: i }) => [
      i.received_at ? new Date(i.received_at).toLocaleString('en-GB') : '',
      i.full_name, i.company_name || '', i.email || '', i.phone || '',
      channelLabel(i.channel), i.source_detail || '', statusLabel(i.status), closeReasonLabel(i.close_reason),
      teamById.get(i.assigned_to)?.name || '',
      i.first_response_at ? String(Math.round((new Date(i.first_response_at) - new Date(i.received_at)) / 60000)) : '',
      i.next_follow_up || '', i.message || '',
    ])
    exportCSV(headers, rows, `SDFM_Inquiries_${new Date().toISOString().slice(0, 10)}`)
  }

  if (loading) {
    return (
      <div>
        <div className="page-header"><h1 className="page-title">Inquiries</h1></div>
        <div className="section-card">{[1, 2, 3].map(i => <div key={i} className="skeleton skeleton-bar" style={{ width: `${100 - i * 15}%` }} />)}</div>
      </div>
    )
  }

  if (setupNeeded) {
    return (
      <div>
        <div className="page-header"><h1 className="page-title">Inquiries</h1></div>
        <div className="section-card inq-setup">
          <h2 className="section-card-title">One-time database setup needed</h2>
          <p>
            Inquiries need two new tables. In the Supabase SQL Editor, run <code>supabase/migration-inquiries.sql</code>
            {' '}(it is safe to run again), then reload this page.
          </p>
        </div>
      </div>
    )
  }

  const owners = [
    { value: '', label: 'Any owner' },
    { value: 'mine', label: 'Mine' },
    { value: 'none', label: 'Unassigned' },
    ...team.filter(t => t.id !== profile?.id).map(t => ({ value: t.id, label: t.name })),
  ]

  return (
    <div className="inq-page">
      <div className="page-header leads-header">
        <div>
          <h1 className="page-title">Inquiries</h1>
          <p className="page-subtitle">
            People who have reached out and are not leads yet · {getPeriodLabel(period)}
          </p>
        </div>
        <div className="leads-header-actions">
          <PeriodSelector value={period} onChange={setPeriod} />
          {inquiries.length > 0 && (
            <>
              <div className="leads-search-wrap">
                <svg className="leads-search-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="7" cy="7" r="5" /><path d="M11 11l3.5 3.5" /></svg>
                <input type="text" className="leads-search" placeholder="Search inquiries..." value={search} onChange={e => setSearch(e.target.value)} aria-label="Search inquiries" />
              </div>
              <div className="leads-export-btns">
                <button className="btn btn-secondary btn-sm" onClick={handleExportCSV}>CSV</button>
              </div>
            </>
          )}
          <button className="btn btn-primary btn-sm" onClick={() => setShowLog(true)}>+ Log inquiry</button>
        </div>
      </div>

      {loadError && <div className="inq-banner inq-banner-error">{loadError}</div>}

      {/* Right now */}
      <div className="inq-stats-row">
        <div className="stat-card stat-card-accent">
          <div className="stat-icon">{StatIcons.open}</div>
          <div className="stat-label">Open now</div>
          <div className="stat-value">{openNow.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">{StatIcons.attention}</div>
          <div className="stat-label">Need attention</div>
          <div className="stat-value">{attentionNow.length}</div>
          <div className="inq-stat-sub">{repliesOverdue} reply overdue · {followUpsDue} follow-up due</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">{StatIcons.rate}</div>
          <div className="stat-label">Became leads</div>
          <div className="stat-value">{stats.conversionRate}%</div>
          <div className="inq-stat-sub">{stats.converted} of {stats.received} received</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">{StatIcons.clock}</div>
          <div className="stat-label">Median first reply</div>
          <div className="stat-value">{formatMinutes(stats.medianReplyMinutes)}</div>
          <div className="inq-stat-sub">{stats.medianDaysToConvert != null ? `${formatDays(stats.medianDaysToConvert)} to become a lead` : `${stats.repliedRate}% replied to`}</div>
        </div>
      </div>

      {/* Channel breakdown */}
      {channelRows.length > 0 && (
        <div className="section-card inq-channel-card">
          <div className="section-card-header">
            <h2 className="section-card-title">Where inquiries come from</h2>
            <span className="inq-card-note">{getPeriodLabel(period)}</span>
          </div>
          <div className="table-scroll">
            <table className="data-table inq-channel-table">
              <thead>
                <tr>
                  <th>Channel</th><th className="inq-num">Received</th><th className="inq-num">Still open</th>
                  <th className="inq-num">Became leads</th><th className="inq-num">Rate</th><th className="inq-num">Median reply</th>
                </tr>
              </thead>
              <tbody>
                {channelRows.map(r => (
                  <tr key={r.channel}>
                    <td className="leads-name">{r.label}</td>
                    <td className="inq-num">{r.received}</td>
                    <td className="inq-num">{r.open}</td>
                    <td className="inq-num">{r.converted}</td>
                    <td className="inq-num">
                      <span className="inq-rate"><span className="inq-rate-bar" style={{ width: `${r.conversionRate}%` }} />{r.conversionRate}%</span>
                    </td>
                    <td className="inq-num">{formatMinutes(r.medianReplyMinutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Work list */}
      <div className="inq-views" role="tablist" aria-label="Inquiry views">
        {VIEWS.map(v => (
          <button
            key={v.key}
            role="tab"
            aria-selected={view === v.key}
            className={`inq-view-tab ${view === v.key ? 'active' : ''} ${v.key === 'attention' && viewCounts.attention > 0 ? 'has-attention' : ''}`}
            onClick={() => { setView(v.key); setViewChosen(true) }}
          >
            {v.label} <span className="inq-view-count">{viewCounts[v.key]}</span>
          </button>
        ))}
      </div>

      <div className="leads-filter-bar">
        <select className="leads-filter-select" value={filterChannel} onChange={e => setFilterChannel(e.target.value)} aria-label="Channel">
          <option value="">All channels</option>
          {CHANNELS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <select className="leads-filter-select" value={filterOwner} onChange={e => setFilterOwner(e.target.value)} aria-label="Owner">
          {owners.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {hasFilters && <button className="leads-filter-clear" onClick={() => { setFilterChannel(''); setFilterOwner(''); setSearch('') }}>Clear filters</button>}
      </div>

      {inquiries.length === 0 ? (
        <div className="section-card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 22h9l2 4h8l2-4h9" /><path d="M8 7h24l3 15v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-9L8 7z" /></svg>
            </div>
            <div className="empty-state-title">No inquiries logged yet</div>
            <p className="empty-state-desc">When someone messages on WhatsApp, calls or emails, log it here so it is followed up and counted.</p>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="section-card">
          <div className="empty-state">
            <div className="empty-state-title">{view === 'attention' && !hasFilters ? 'Nothing needs attention' : 'No inquiries match'}</div>
            <p className="empty-state-desc">
              {view === 'attention' && !hasFilters ? 'Every open inquiry has been answered and has no follow-up due.' : 'Try another view or clear the filters.'}
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="leads-table-wrap section-card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Who</th><th>Channel</th><th>Status</th><th>Next step</th><th>Owner</th><th>Received</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(({ inq, reasons }) => (
                  <tr key={inq.id} className="leads-row-clickable" onClick={() => setSelectedId(inq.id)}>
                    <td>
                      <button className="inq-row-link" onClick={e => { e.stopPropagation(); setSelectedId(inq.id) }}>
                        <span className="leads-name">{inq.full_name}</span>
                        {inq.company_name && <span className="inq-sub">{inq.company_name}</span>}
                      </button>
                    </td>
                    <td className="inq-muted">{channelLabel(inq.channel)}</td>
                    <td><span className={`inq-status inq-status-${inq.status}`}>{statusLabel(inq.status)}</span></td>
                    <td>
                      <div className="inq-next">
                        {reasons.map(r => <span key={r} className="inq-attention">{r}</span>)}
                        {isOpen(inq) && inq.next_follow_up && !reasons.includes('Follow-up due') && <span className="inq-sub">Follow up {shortDay(inq.next_follow_up)}</span>}
                        {inq.status === 'closed' && <span className="inq-sub">{closeReasonLabel(inq.close_reason)}</span>}
                        {inq.status === 'converted' && <span className="inq-sub">{inq.converted_at ? `On ${shortDate(inq.converted_at)}` : ''}</span>}
                      </div>
                    </td>
                    <td className="inq-muted">{teamById.get(inq.assigned_to)?.name || <span className="inq-sub">Unassigned</span>}</td>
                    <td className="inq-muted" title={shortDate(inq.received_at)}>{timeAgo(inq.received_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="leads-mobile-list">
            {filtered.map(({ inq, reasons }) => (
              <div key={inq.id} className="leads-mobile-card leads-row-clickable" onClick={() => setSelectedId(inq.id)}>
                <div className="leads-mobile-card-top">
                  <div>
                    <div className="leads-mobile-name">{inq.full_name}</div>
                    <div className="leads-mobile-company">{inq.company_name || channelLabel(inq.channel)}</div>
                  </div>
                  <span className={`inq-status inq-status-${inq.status}`}>{statusLabel(inq.status)}</span>
                </div>
                {reasons.length > 0 && <div className="inq-next inq-next-mobile">{reasons.map(r => <span key={r} className="inq-attention">{r}</span>)}</div>}
                <div className="leads-mobile-card-bottom">
                  <span className="leads-mobile-meta"><span className="leads-mobile-label">Via</span>{channelLabel(inq.channel)}</span>
                  <span className="leads-mobile-meta"><span className="leads-mobile-label">Owner</span>{teamById.get(inq.assigned_to)?.name || 'Unassigned'}</span>
                  <span className="leads-mobile-meta"><span className="leads-mobile-label">Received</span>{timeAgo(inq.received_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {selected && (
        <InquiryDetail
          key={selected.id}
          inquiry={selected}
          team={team}
          leads={leads}
          canDelete={profile?.role === 'admin'}
          onClose={() => setSelectedId(null)}
          onChanged={replaceInquiry}
          onConvert={setConvertTarget}
          onCloseInquiry={setCloseTarget}
          onDelete={setDeleteTarget}
        />
      )}

      {showLog && (
        <LogInquiryModal
          team={team}
          inquiries={inquiries}
          leads={leads}
          onClose={() => setShowLog(false)}
          onSaved={created => {
            setInquiries(prev => [created, ...prev])
            setShowLog(false)
            setSelectedId(created.id)
            showToast('success', `${created.full_name} logged`)
          }}
        />
      )}

      {convertTarget && (
        <ConvertInquiryModal
          inquiry={convertTarget}
          inquiries={inquiries}
          leads={leads}
          onClose={() => setConvertTarget(null)}
          onConverted={handleConverted}
        />
      )}

      {closeTarget && (
        <CloseInquiryModal inquiry={closeTarget} onClose={() => setCloseTarget(null)} onClosed={handleClosed} />
      )}

      {deleteTarget && (
        <div className="modal-overlay" onClick={() => !deleting && setDeleteTarget(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
            <h3 className="modal-title">Delete this inquiry?</h3>
            <p className="modal-subtitle">
              {deleteTarget.full_name}'s inquiry and its activity log will be removed. A lead created from it is not affected. This cannot be undone.
            </p>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</button>
              <button className="btn btn-danger" onClick={handleConfirmDelete} disabled={deleting}>{deleting ? 'Deleting...' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}

      {toast.show && (
        <div className={`toast toast-${toast.type}`} role="status">
          {toast.type === 'success' ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 8.5l3 3 5-6" /></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="8" cy="8" r="6" /><path d="M8 5v3.5M8 10.5v.5" /></svg>
          )}
          {toast.text}
        </div>
      )}
    </div>
  )
}
