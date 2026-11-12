import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { exportCSV } from '../lib/exportUtils'
import { isMissingTable, shortDate, shortDateTime, timeAgo } from '../lib/inquiries'
import {
  FOUNDING_CAP, SPEND_ORDER, STATUSES, adTag, pageLabel, sourceLabel, spendFloor, statusLabel, statusTone, summarise, tally,
} from '../lib/ospodWaitlist'
import PeriodSelector, { filterByPeriod, getPeriodLabel } from '../components/PeriodSelector/PeriodSelector'
import '../components/LeadDetail/LeadDetail.css'
import '../components/InquiryDetail/InquiryDetail.css'
import './AllLeads.css'
import './Inquiries.css'
import './OspodWaitlist.css'

const StatIcons = {
  people: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="7" cy="6" r="3" /><path d="M1.5 15c.5-3 2.500-4.500 5.500-4.500s5 1.500 5.500 4.500" /><path d="M12.500 3.500a3 3 0 0 1 0 5M14.500 10.800c1.300.6 2.200 1.900 2.500 4.200" /></svg>,
  spots: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="2" y="3" width="14" height="12" rx="2" /><path d="M5 10l2.500 2.500L13 7" /></svg>,
  studio: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2.500 15.500v-9l6.500-4 6.500 4v9" /><path d="M7 15.500v-5h4v5" /></svg>,
  money: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="9" cy="9" r="7" /><path d="M9 5v8M6.800 7.200c0-.9.9-1.500 2.200-1.500s2.200.6 2.200 1.500c0 2.200-4.400 1-4.400 3.300 0 .9 1 1.500 2.200 1.500s2.200-.6 2.200-1.500" /></svg>,
}

const VIEWS = [
  { key: 'new', label: 'New', match: r => r.status === 'new' },
  { key: 'follow', label: 'Following up', match: r => r.status === 'contacted' || r.status === 'call_booked' },
  { key: 'done', label: 'Interviewed', match: r => r.status === 'interviewed' },
  { key: 'out', label: 'Not a fit', match: r => r.status === 'not_a_fit' },
  { key: 'all', label: 'All', match: () => true },
]

function Breakdown({ title, items, total }) {
  return (
    <div className="ow-break">
      <h3>{title}</h3>
      {items.length === 0 && <div className="inq-sub">No data yet</div>}
      {items.map(({ label, count }) => (
        <div key={label} className="ow-bar-row">
          <span className="ow-bar-label" title={label}>{label}</span>
          <span className="ow-bar-count">{count}</span>
          <div className="ow-bar-track"><div className="ow-bar-fill" style={{ width: `${total ? Math.max(4, Math.round((count / total) * 100)) : 0}%` }} /></div>
        </div>
      ))}
    </div>
  )
}

function SignupDetail({ row, isAdmin, onClose, onChanged, onDeleted }) {
  const [notes, setNotes] = useState(row.notes || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { setNotes(row.notes || '') }, [row.id, row.notes])
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  async function patch(values) {
    setError('')
    setSaving(true)
    const { data, error: err } = await supabase
      .from('ospod_waitlist_signups').update(values).eq('id', row.id).select().single()
    setSaving(false)
    if (err || !data) {
      setError(err?.message || 'Could not save the change.')
      return
    }
    onChanged(data)
  }

  async function remove() {
    if (!window.confirm(`Delete ${row.email} from the Ospod waitlist? This cannot be undone.`)) return
    const { error: err } = await supabase.from('ospod_waitlist_signups').delete().eq('id', row.id)
    if (err) { setError(err.message || 'Could not delete.'); return }
    onDeleted(row.id)
  }

  const field = (label, value) => (
    <div className="lead-detail-field">
      <span className="lead-detail-field-label">{label}</span>
      <span className="lead-detail-field-value">{value || '—'}</span>
    </div>
  )

  return (
    <>
      <div className="lead-detail-overlay" onClick={onClose} />
      <div className="lead-detail-drawer" role="dialog" aria-modal="true" aria-label={`Ospod signup ${row.email}`}>
        <div className="lead-detail-header">
          <div className="lead-detail-header-top">
            <button className="lead-detail-close" onClick={onClose} aria-label="Close">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M14 6L6 14M6 6l8 8" /></svg>
            </button>
          </div>
          <div className="lead-detail-identity">
            <div className="lead-detail-avatar">{row.email.charAt(0).toUpperCase()}</div>
            <div>
              <h2 className="lead-detail-name">{row.email}</h2>
              <p className="lead-detail-company">Waitlist #{row.member_no}{row.member_no <= FOUNDING_CAP ? ' · Founding 500' : ' · After the Founding 500'}</p>
            </div>
          </div>
          <div className="lead-detail-meta-row">
            <span className={`inq-status inq-status-${statusTone(row.status)}`}>{statusLabel(row.status)}</span>
            <span className="inq-channel-tag">{pageLabel(row.variant)}</span>
          </div>
          <div className="lead-detail-contact-actions">
            <a
              href={`mailto:${row.email}?subject=${encodeURIComponent('Ospod')}`}
              className="lead-detail-contact-btn"
              title={`Email ${row.email}`}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><rect x="1" y="3" width="12" height="8" rx="1.5" /><path d="M1 4.500l6 4 6-4" /></svg>
              Email
            </a>
          </div>
        </div>

        <div className="lead-detail-body">
          {error && <p className="form-error ow-detail-error">{error}</p>}

          <div className="lead-detail-section">
            <div className="lead-detail-field-group">
              <div className="lead-detail-field">
                <span className="lead-detail-field-label">Status</span>
                <select className="form-input inq-inline-select" value={row.status} disabled={saving} onChange={e => patch({ status: e.target.value })} aria-label="Status">
                  {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
              {field('Describes them', row.role)}
              {field('Shows they produce', row.shows)}
              {field('Episodes a month', row.episodes)}
              {field('Spends on editing', row.spend)}
              {field('Joined', shortDateTime(row.created_at))}
              {field('Source', sourceLabel(row))}
              {field('Landing page', row.page_path)}
              {field('Referrer', row.referrer)}
              {field('Team alert emailed', row.notified_at ? shortDateTime(row.notified_at) : 'Not sent (check Resend and who has this module)')}
            </div>

            <div className="lead-detail-field ow-notes-field">
              <span className="lead-detail-field-label">Notes</span>
              <textarea
                className="form-input ow-notes"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="What you learned, what to follow up on..."
                aria-label="Notes"
              />
              <div className="ow-detail-actions">
                <button className="btn btn-primary btn-sm" disabled={saving || notes === (row.notes || '')} onClick={() => patch({ notes: notes.trim() || null })}>
                  {saving ? 'Saving...' : 'Save notes'}
                </button>
                {isAdmin && <button className="btn btn-danger btn-sm" onClick={remove}>Delete</button>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

export default function OspodWaitlist() {
  const { profile } = useAuth()
  const [params, setParams] = useSearchParams()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [setupNeeded, setSetupNeeded] = useState(false)
  const [loadError, setLoadError] = useState('')

  const now = new Date()
  const [period, setPeriod] = useState({ mode: 'all', month: now.getMonth(), year: now.getFullYear() })
  const [view, setView] = useState('all')
  const [page, setPage] = useState('all')
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
      .from('ospod_waitlist_signups').select('*').order('member_no', { ascending: false }).limit(2000)
    if (error) {
      if (isMissingTable(error)) setSetupNeeded(true)
      else setLoadError(error.message || 'Could not load the signups.')
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

  const inPeriod = filterByPeriod(rows, period, 'created_at')
  const scoped = inPeriod.filter(r => page === 'all' || r.variant === page)
  const stats = summarise(scoped)
  const counts = Object.fromEntries(VIEWS.map(v => [v.key, scoped.filter(v.match).length]))

  const filtered = useMemo(() => {
    const match = VIEWS.find(v => v.key === view).match
    const q = search.trim().toLowerCase()
    return scoped.filter(match).filter(r => !q || [r.email, r.role, r.utm_content, r.utm_campaign, r.notes].some(v => v && v.toLowerCase().includes(q)))
  }, [scoped, view, search])

  function handleExportCSV() {
    const headers = ['#', 'Joined', 'Email', 'Page', 'Describes them', 'Shows', 'Episodes a month', 'Spends on editing', 'Status', 'Ad tag', 'UTM source', 'UTM medium', 'UTM campaign', 'Referrer', 'Notes']
    const data = filtered.map(r => [
      r.member_no, r.created_at ? new Date(r.created_at).toLocaleString('en-GB') : '', r.email, pageLabel(r.variant), r.role, r.shows, r.episodes, r.spend,
      statusLabel(r.status), adTag(r), r.utm_source || '', r.utm_medium || '', r.utm_campaign || '', r.referrer || '', r.notes || '',
    ])
    exportCSV(headers, data, `Ospod_Waitlist_${new Date().toISOString().slice(0, 10)}`)
  }

  if (loading) {
    return (
      <div>
        <div className="page-header"><h1 className="page-title">Ospod Waitlist</h1></div>
        <div className="section-card">{[1, 2, 3].map(i => <div key={i} className="skeleton skeleton-bar" style={{ width: `${100 - i * 15}%` }} />)}</div>
      </div>
    )
  }

  if (setupNeeded) {
    return (
      <div>
        <div className="page-header"><h1 className="page-title">Ospod Waitlist</h1></div>
        <div className="section-card inq-setup">
          <h2 className="section-card-title">One-time database setup needed</h2>
          <p>
            The Ospod waitlist needs one new table. In the Supabase SQL Editor, run <code>supabase/migration-ospod-waitlist.sql</code>
            {' '}(it is safe to run again), then reload this page. The landing pages save through the <code>ospod-waitlist</code> Edge Function; see the README for deploying it.
          </p>
        </div>
      </div>
    )
  }

  const selected = selectedId ? rows.find(r => r.id === selectedId) : null
  const left = Math.max(0, FOUNDING_CAP - rows.length)

  return (
    <div className="inq-page">
      <div className="page-header leads-header">
        <div>
          <h1 className="page-title">Ospod Waitlist</h1>
          <p className="page-subtitle">People who joined from the Ospod landing pages · {getPeriodLabel(period)}</p>
        </div>
        <div className="leads-header-actions">
          <PeriodSelector value={period} onChange={setPeriod} />
          {rows.length > 0 && (
            <>
              <div className="leads-search-wrap">
                <svg className="leads-search-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="7" cy="7" r="5" /><path d="M11 11l3.500 3.500" /></svg>
                <input type="text" className="leads-search" placeholder="Search email, ad tag, notes..." value={search} onChange={e => setSearch(e.target.value)} aria-label="Search signups" />
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
          <div className="stat-icon">{StatIcons.people}</div>
          <div className="stat-label">Signups</div>
          <div className="stat-value">{stats.total}</div>
          <div className="inq-stat-sub">{stats.last7} in the last 7 days</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">{StatIcons.spots}</div>
          <div className="stat-label">Founding spots</div>
          <div className="stat-value">{Math.min(rows.length, FOUNDING_CAP)}<span className="ga-of">/{FOUNDING_CAP}</span></div>
          <div className="inq-stat-sub">{left === 0 ? 'Founding 500 is full' : `${left} left, across all time`}</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">{StatIcons.studio}</div>
          <div className="stat-label">From the studios page</div>
          <div className="stat-value">{stats.studios}</div>
          <div className="inq-stat-sub">{stats.total ? Math.round((stats.studios / stats.total) * 100) : 0}% of signups</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">{StatIcons.money}</div>
          <div className="stat-label">Already pay $100+/mo to edit</div>
          <div className="stat-value">{stats.payers}</div>
          <div className="inq-stat-sub">{stats.total ? Math.round((stats.payers / stats.total) * 100) : 0}% of signups</div>
        </div>
      </div>

      {scoped.length > 0 && (
        <div className="section-card ow-breakdown">
          <Breakdown title="By ad (utm_content)" items={tally(scoped, adTag)} total={scoped.length} />
          <Breakdown title="Who they are" items={tally(scoped, r => r.role)} total={scoped.length} />
          <Breakdown title="What they spend on editing" items={tally(scoped, r => r.spend, SPEND_ORDER)} total={scoped.length} />
        </div>
      )}

      <div className="inq-views" role="tablist" aria-label="Waitlist views">
        {VIEWS.map(v => (
          <button key={v.key} role="tab" aria-selected={view === v.key} className={`inq-view-tab ${view === v.key ? 'active' : ''}`} onClick={() => setView(v.key)}>
            {v.label} <span className="inq-view-count">{counts[v.key]}</span>
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <select className="form-input inq-inline-select" value={page} onChange={e => setPage(e.target.value)} aria-label="Landing page">
          <option value="all">Both landing pages</option>
          <option value="indie">Podcasters page</option>
          <option value="studios">Studios page</option>
        </select>
      </div>

      {rows.length === 0 ? (
        <div className="section-card">
          <div className="empty-state">
            <div className="empty-state-title">No signups yet</div>
            <p className="empty-state-desc">When someone joins the waitlist on an Ospod landing page, they appear here and you get an email.</p>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="section-card">
          <div className="empty-state">
            <div className="empty-state-title">No signups match</div>
            <p className="empty-state-desc">Try another view or clear the search.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="leads-table-wrap section-card">
            <table className="data-table">
              <thead>
                <tr><th>#</th><th>Email</th><th>Who</th><th>Shows · episodes</th><th>Editing spend</th><th>Status</th><th>Ad</th><th>Joined</th></tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id} className="leads-row-clickable" onClick={() => select(r.id)}>
                    <td className="ow-num">{r.member_no}</td>
                    <td>
                      <button className="inq-row-link" onClick={e => { e.stopPropagation(); select(r.id) }}>
                        <span className="leads-name">{r.email}</span>
                        <span className="inq-sub">{pageLabel(r.variant)}</span>
                      </button>
                    </td>
                    <td className="inq-muted">{r.role}</td>
                    <td className="inq-muted">{r.shows} · {r.episodes}</td>
                    <td>{spendFloor(r) >= 100 ? <span className="ow-tag ow-tag-warn">{r.spend}</span> : <span className="inq-muted">{r.spend}</span>}</td>
                    <td><span className={`inq-status inq-status-${statusTone(r.status)}`}>{statusLabel(r.status)}</span></td>
                    <td><span className="ow-tag">{adTag(r)}</span></td>
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
                    <div className="leads-mobile-name">{r.email}</div>
                    <div className="leads-mobile-company">#{r.member_no} · {pageLabel(r.variant)}</div>
                  </div>
                  <span className={`inq-status inq-status-${statusTone(r.status)}`}>{statusLabel(r.status)}</span>
                </div>
                <div className="leads-mobile-card-bottom">
                  <span className="leads-mobile-meta"><span className="leads-mobile-label">Who</span>{r.role}</span>
                  <span className="leads-mobile-meta"><span className="leads-mobile-label">Spend</span>{r.spend}</span>
                  <span className="leads-mobile-meta"><span className="leads-mobile-label">Ad</span>{adTag(r)}</span>
                  <span className="leads-mobile-meta"><span className="leads-mobile-label">Joined</span>{timeAgo(r.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {selected && (
        <SignupDetail
          row={selected}
          isAdmin={profile?.role === 'admin'}
          onClose={() => select(null)}
          onChanged={updated => setRows(prev => prev.map(r => (r.id === updated.id ? updated : r)))}
          onDeleted={id => {
            setRows(prev => prev.filter(r => r.id !== id))
            select(null)
            setToast({ show: true, type: 'success', text: 'Signup deleted' })
          }}
        />
      )}

      {toast.show && <div className={`toast toast-${toast.type}`}>{toast.text}</div>}
    </div>
  )
}
