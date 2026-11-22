import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DateTime } from 'luxon'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { useSocialAccounts } from '../../lib/socialAccounts'
import { platformOf, POST_TYPE_LABELS } from '../../lib/platforms'
import { fetchBestTimes, slotInstants } from '../../lib/bestTimes'
import { AccountBar, AccountAvatar, SocialHeader, EmptyState } from '../../components/social/SocialUI'
import QueueSettings from './planner/QueueSettings'
import AutolistsPanel from './planner/AutolistsPanel'
import './Planner.css'

export const STATUS_LABELS = {
  draft: 'Draft',
  pending_approval: 'Pending approval',
  changes_requested: 'Changes requested',
  scheduled: 'Scheduled',
  publishing: 'Publishing',
  ready_to_post: 'Ready to post',
  posted: 'Published',
  failed: 'Failed',
}

const STATUS_COLORS = {
  draft: '#9ca3af', pending_approval: '#b45309', changes_requested: '#EC3013', scheduled: '#1d4ed8',
  publishing: '#0e7490', ready_to_post: '#7c3aed', posted: '#15803d', failed: '#EC3013',
}

const HOURS = Array.from({ length: 24 }, (_, h) => h)
const ACTIVE = ['scheduled', 'pending_approval', 'publishing', 'ready_to_post']

function preview(caption, len = 80) {
  const t = (caption || '').trim()
  return t.length > len ? `${t.slice(0, len)}…` : t || '(No caption)'
}

// Posts composed together (one per account) share post_group_id: shown as one card.
function groupPosts(posts) {
  const map = new Map()
  for (const p of posts) {
    const key = p.post_group_id || p.id
    const g = map.get(key) || { id: key, posts: [] }
    g.posts.push(p)
    map.set(key, g)
  }
  return [...map.values()].map(g => {
    const first = g.posts.slice().sort((a, b) => (a.scheduled_at || '').localeCompare(b.scheduled_at || ''))[0]
    const statuses = [...new Set(g.posts.map(p => p.status))]
    return {
      ...g,
      lead: first,
      at: first.scheduled_at ? DateTime.fromISO(first.scheduled_at) : null,
      status: statuses.includes('failed') ? 'failed' : statuses.length === 1 ? statuses[0] : first.status,
      draggable: g.posts.every(p => ['scheduled', 'draft', 'changes_requested'].includes(p.status)),
    }
  })
}

export default function Planner() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { accounts, loading: accountsLoading, selected, selectedIds, setSelected } = useSocialAccounts()

  const [view, setView] = useState(() => { try { return localStorage.getItem('sm.plannerView') || 'week' } catch { return 'week' } })
  const [anchor, setAnchor] = useState(DateTime.now())
  const [posts, setPosts] = useState([])
  const [slots, setSlots] = useState([])
  const [best, setBest] = useState({ cells: [], isDefault: true })
  const [todo, setTodo] = useState({ failed: [], ready: [], pending: 0, drafts: [] })
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [dragGroup, setDragGroup] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [showQueue, setShowQueue] = useState(false)
  const [showAutolists, setShowAutolists] = useState(false)
  const [selectedGroups, setSelectedGroups] = useState([])
  const [toast, setToast] = useState(null)
  const gridRef = useRef(null)

  const visibleAccounts = useMemo(() => accounts.filter(a => selectedIds.includes(a.id)), [accounts, selectedIds])
  const accountById = useMemo(() => Object.fromEntries(accounts.map(a => [a.id, a])), [accounts])

  function showToast(type, text) {
    setToast({ type, text })
    setTimeout(() => setToast(null), 4000)
  }

  function changeView(v) {
    setView(v)
    try { localStorage.setItem('sm.plannerView', v) } catch { /* ignore */ }
  }

  const range = useMemo(() => {
    if (view === 'week') return { start: anchor.startOf('week'), end: anchor.endOf('week') }
    if (view === 'month') return { start: anchor.startOf('month').startOf('week'), end: anchor.endOf('month').endOf('week') }
    return { start: DateTime.now().minus({ days: 30 }).startOf('day'), end: DateTime.now().plus({ days: 90 }).endOf('day') }
  }, [view, anchor])

  useEffect(() => { if (!accountsLoading) loadAll() }, [range, selectedIds.join(','), accountsLoading]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Start the week grid at 07:00.
    if (view === 'week' && gridRef.current) gridRef.current.scrollTop = 7 * 56 - 8
  }, [view, loading])

  async function loadAll() {
    setLoading(true)
    const ids = selectedIds.length ? selectedIds : ['00000000-0000-0000-0000-000000000000']
    const [postsRes, slotsRes, failedRes, readyRes, pendingRes, draftsRes] = await Promise.all([
      supabase.from('posts')
        .select('id, post_group_id, account_id, post_type, caption, status, scheduled_at, posted_at, external_post_url, publish_error, autolist_id, recurrence, created_by, profiles(name)')
        .eq('is_template', false).in('account_id', ids)
        .gte('scheduled_at', range.start.toISO()).lte('scheduled_at', range.end.toISO())
        .order('scheduled_at'),
      supabase.from('posting_slots').select('*').in('account_id', ids).eq('active', true),
      supabase.from('posts').select('id, post_group_id, account_id, caption, publish_error, scheduled_at')
        .eq('is_template', false).eq('status', 'failed').in('account_id', ids).order('scheduled_at', { ascending: false }).limit(20),
      supabase.from('posts').select('id, account_id, caption, hashtags, scheduled_at, post_assets(content_assets(file_path))')
        .eq('is_template', false).eq('status', 'ready_to_post').in('account_id', ids).order('scheduled_at').limit(20),
      supabase.from('posts').select('post_group_id', { count: 'exact', head: true }).eq('is_template', false).eq('status', 'pending_approval'),
      supabase.from('posts').select('id, post_group_id, account_id, caption, updated_at')
        .eq('is_template', false).eq('status', 'draft').is('scheduled_at', null).order('updated_at', { ascending: false }).limit(10),
    ])
    setPosts(postsRes.data || [])
    setSlots(slotsRes.data || [])
    setTodo({ failed: failedRes.data || [], ready: readyRes.data || [], pending: pendingRes.count || 0, drafts: draftsRes.data || [] })
    setBest(await fetchBestTimes(visibleAccounts))
    setLoading(false)
  }

  const groups = useMemo(() => groupPosts(posts.filter(p => statusFilter === 'all' || p.status === statusFilter)), [posts, statusFilter])

  // Queue slot instants in view (per account) not already holding a post.
  const openSlots = useMemo(() => {
    const out = []
    const now = DateTime.now()
    for (const a of visibleAccounts) {
      const mine = slots.filter(s => s.account_id === a.id)
      if (!mine.length) continue
      const taken = new Set(posts.filter(p => p.account_id === a.id && p.scheduled_at).map(p => DateTime.fromISO(p.scheduled_at).startOf('minute').toMillis()))
      for (const at of slotInstants(mine, a.timezone || 'Africa/Nairobi', range.start > now ? range.start : now, range.end)) {
        if (!taken.has(at.startOf('minute').toMillis())) out.push({ account: a, at })
      }
    }
    return out
  }, [slots, visibleAccounts, posts, range])

  const heat = useMemo(() => {
    const max = Math.max(0, ...best.cells.map(c => c.value || 0))
    const m = new Map(best.cells.map(c => [`${c.weekday}-${c.hour}`, max ? (c.value || 0) / max : 0]))
    return (weekday, hour) => m.get(`${weekday}-${hour}`) || 0
  }, [best])

  function compose(params = {}) {
    const q = new URLSearchParams(params).toString()
    navigate(`/social/composer${q ? `?${q}` : ''}`)
  }

  // ── Drag & drop rescheduling (keeps the minutes, moves day and hour) ──
  async function dropOn(day, hour) {
    const g = dragGroup
    setDragGroup(null)
    if (!g || !g.draggable) return
    const updates = g.posts.map(p => {
      const orig = p.scheduled_at ? DateTime.fromISO(p.scheduled_at) : day
      const at = day.set({ hour: hour ?? orig.hour, minute: orig.minute, second: 0 })
      return supabase.from('posts').update({ scheduled_at: at.toISO() }).eq('id', p.id)
    })
    const results = await Promise.all(updates)
    if (results.some(r => r.error)) { showToast('error', 'Could not reschedule'); return }
    showToast('success', 'Rescheduled')
    loadAll()
  }

  // ── To-do actions ──
  async function retry(post) {
    setBusyId(post.id)
    const { data, error } = await supabase.functions.invoke('sm-publish', { body: { post_id: post.id } })
    setBusyId(null)
    if (error || !data?.success) showToast('error', data?.error || 'Publishing failed')
    else showToast('success', data.status === 'posted' ? 'Published' : data.message)
    loadAll()
  }

  async function postManually(post) {
    await supabase.from('posts').update({ status: 'ready_to_post' }).eq('id', post.id)
    loadAll()
  }

  async function copyAndOpen(post) {
    const account = accountById[post.account_id]
    const text = [post.caption, (post.hashtags || []).map(h => `#${h}`).join(' ')].filter(Boolean).join('\n\n')
    try { await navigator.clipboard?.writeText(text) } catch { /* clipboard unavailable */ }
    const paths = (post.post_assets || []).map(pa => pa.content_assets?.file_path).filter(Boolean)
    if (paths.length) {
      const { data: signed } = await supabase.storage.from('content-library').createSignedUrls(paths, 300)
      signed?.forEach(s => { if (s.signedUrl) { const a = document.createElement('a'); a.href = s.signedUrl; a.download = ''; document.body.appendChild(a); a.click(); a.remove() } })
    }
    const home = { linkedin: 'https://www.linkedin.com/feed/', facebook: 'https://www.facebook.com/', instagram: 'https://www.instagram.com/', x: 'https://x.com/compose/post', tiktok: 'https://www.tiktok.com/upload', threads: 'https://www.threads.net/', youtube: 'https://studio.youtube.com/' }
    window.open(home[account?.platform] || home.linkedin, '_blank', 'noopener,noreferrer')
    showToast('success', 'Caption copied — paste it in')
  }

  async function markPosted(post) {
    await supabase.from('posts').update({ status: 'posted', posted_at: new Date().toISOString() }).eq('id', post.id)
    loadAll()
  }

  // ── List bulk actions ──
  async function bulkDelete() {
    const ids = groups.filter(g => selectedGroups.includes(g.id)).flatMap(g => g.posts.map(p => p.id))
    if (!ids.length || !window.confirm(`Delete ${ids.length} post(s)? This cannot be undone.`)) return
    await supabase.from('posts').delete().in('id', ids)
    setSelectedGroups([])
    loadAll()
  }

  async function bulkDuplicate() {
    const chosen = groups.filter(g => selectedGroups.includes(g.id))
    for (const g of chosen) {
      const groupId = crypto.randomUUID()
      for (const p of g.posts) {
        const { data: full } = await supabase.from('posts').select('*').eq('id', p.id).single()
        if (!full) continue
        const { id: _id, created_at: _c, updated_at: _u, external_post_urn: _e, external_post_url: _eu, last_stats: _l, stats_synced_at: _s, publish_state: _ps, publish_error: _pe, first_comment_urn: _fc, posted_at: _pa, ...rest } = full
        const { data: copy } = await supabase.from('posts').insert({ ...rest, status: 'draft', scheduled_at: null, post_group_id: groupId, publish_attempts: 0, recurrence_parent_id: null, occurrence: 1, created_by: profile?.id }).select('id').single()
        const { data: assets } = await supabase.from('post_assets').select('asset_id, position').eq('post_id', p.id)
        if (copy && assets?.length) await supabase.from('post_assets').insert(assets.map(a => ({ ...a, post_id: copy.id })))
      }
    }
    setSelectedGroups([])
    showToast('success', 'Duplicated as drafts')
    loadAll()
  }

  // ── Render helpers ──
  function GroupCard({ g, compact }) {
    return (
      <div
        className={`pl-card ${compact ? 'compact' : ''}`}
        style={{ borderLeftColor: STATUS_COLORS[g.status] }}
        draggable={g.draggable}
        onDragStart={e => { e.stopPropagation(); setDragGroup(g) }}
        onClick={e => { e.stopPropagation(); g.status === 'posted' && g.lead.external_post_url && g.posts.length === 1 ? window.open(g.lead.external_post_url, '_blank', 'noopener') : navigate(`/social/composer/${g.lead.id}`) }}
        title={`${STATUS_LABELS[g.status]} — ${g.lead.caption || ''}`}
      >
        <div className="pl-card-top">
          <span className="pl-card-time">{g.at ? g.at.toFormat('HH:mm') : '—'}</span>
          <span className="pl-card-accounts">
            {g.posts.slice(0, 4).map(p => accountById[p.account_id] && <AccountAvatar key={p.id} account={accountById[p.account_id]} size={18} />)}
          </span>
        </div>
        {!compact && <div className="pl-card-caption">{preview(g.lead.caption, 70)}</div>}
        {!compact && (
          <div className="pl-card-meta">
            <span className="pl-status-dot" style={{ background: STATUS_COLORS[g.status] }} />{STATUS_LABELS[g.status]}
            {g.lead.autolist_id && <span title="From an autolist"> · ♻</span>}
            {g.lead.recurrence && <span title="Recurring"> · ↻</span>}
          </div>
        )}
      </div>
    )
  }

  const days = []
  for (let d = range.start; d <= range.end && view !== 'list'; d = d.plus({ days: 1 })) days.push(d)
  const now = DateTime.now()

  return (
    <div className="planner-page">
      <SocialHeader title="Planner" subtitle={best.isDefault ? 'Shaded hours = industry best times (yours appear after 10 published posts)' : `Shaded hours = your best times (from ${best.sample} posts)`}>
        {todo.pending > 0 && <button className="btn btn-secondary btn-sm" onClick={() => navigate('/social/approvals')}>Approvals <span className="pl-badge">{todo.pending}</span></button>}
        <button className="btn btn-secondary btn-sm" onClick={() => setShowAutolists(true)}>♻ Autolists</button>
        <button className="btn btn-secondary btn-sm" onClick={() => setShowQueue(true)}>Posting schedule</button>
        <button className="btn btn-secondary btn-sm" onClick={() => navigate('/social/bulk-schedule')}>Bulk import</button>
        <button className="btn btn-primary btn-sm" onClick={() => compose()}>+ Create post</button>
      </SocialHeader>

      <AccountBar accounts={accounts} selected={selected} onChange={setSelected} />

      <div className="pl-layout">
        <div className="pl-main">
          <div className="pl-toolbar">
            <div className="sm-tabs">
              {['week', 'month', 'list'].map(v => <button key={v} className={`sm-tab ${view === v ? 'active' : ''}`} onClick={() => changeView(v)}>{v[0].toUpperCase() + v.slice(1)}</button>)}
            </div>
            {view !== 'list' && (
              <div className="pl-nav">
                <button className="btn btn-secondary btn-sm" onClick={() => setAnchor(a => a.minus(view === 'week' ? { weeks: 1 } : { months: 1 }))} aria-label="Previous">‹</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setAnchor(DateTime.now())}>Today</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setAnchor(a => a.plus(view === 'week' ? { weeks: 1 } : { months: 1 }))} aria-label="Next">›</button>
                <span className="pl-nav-label">{view === 'week' ? `${range.start.toFormat('d LLL')} – ${range.end.toFormat('d LLL yyyy')}` : anchor.toFormat('LLLL yyyy')}</span>
              </div>
            )}
            <select className="form-input form-input-sm pl-filter" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="all">All statuses</option>
              {Object.entries(STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>

          {accounts.length === 0 && !accountsLoading ? (
            <div className="section-card"><EmptyState title="No social accounts connected" action={<button className="btn btn-primary btn-sm" onClick={() => navigate('/settings/integrations')}>Connect an account</button>}>Connect LinkedIn in Settings → Integrations to start planning.</EmptyState></div>
          ) : view === 'week' ? (
            <div className="pl-week" ref={gridRef}>
              <div className="pl-week-head">
                <span />
                {days.map(d => <span key={d.toISODate()} className={`pl-week-day ${d.hasSame(now, 'day') ? 'today' : ''}`}>{d.toFormat('ccc')} <b>{d.day}</b></span>)}
              </div>
              {HOURS.map(h => (
                <div key={h} className="pl-week-row">
                  <span className="pl-week-hour">{String(h).padStart(2, '0')}:00</span>
                  {days.map(d => {
                    const cellStart = d.set({ hour: h, minute: 0, second: 0 })
                    const past = cellStart.plus({ hours: 1 }) < now
                    const cellGroups = groups.filter(g => g.at && g.at.hasSame(d, 'day') && g.at.hour === h)
                    const cellSlots = openSlots.filter(s => s.at.hasSame(d, 'day') && s.at.hour === h)
                    const strength = heat(d.weekday, h)
                    return (
                      <div
                        key={d.toISODate()}
                        className={`pl-cell ${past ? 'past' : ''}`}
                        style={strength && !past ? { background: `rgba(22, 163, 74, ${0.05 + strength * 0.12})` } : undefined}
                        onDragOver={e => !past && e.preventDefault()}
                        onDrop={() => !past && dropOn(d, h)}
                        onClick={() => !past && compose({ at: cellStart.plus({ minutes: cellStart < now ? Math.ceil(now.diff(cellStart, 'minutes').minutes / 15) * 15 : 0 }).toISO() })}
                      >
                        {cellGroups.map(g => <GroupCard key={g.id} g={g} />)}
                        {cellSlots.map(s => (
                          <button key={s.account.id + s.at.toISO()} className="pl-slot" onClick={e => { e.stopPropagation(); compose({ at: s.at.toISO(), account: s.account.id }) }} title={`Free queue slot for ${s.account.account_name}`}>
                            <AccountAvatar account={s.account} size={14} /> {s.at.toFormat('HH:mm')}
                          </button>
                        ))}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          ) : view === 'month' ? (
            <div className="pl-month">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <div key={d} className="pl-month-dow">{d}</div>)}
              {days.map(d => {
                const dayGroups = groups.filter(g => g.at && g.at.hasSame(d, 'day')).sort((a, b) => a.at - b.at)
                const daySlots = openSlots.filter(s => s.at.hasSame(d, 'day')).length
                return (
                  <div
                    key={d.toISODate()}
                    className={`pl-month-cell ${d.month !== anchor.month ? 'other' : ''} ${d.hasSame(now, 'day') ? 'today' : ''}`}
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => dropOn(d, null)}
                    onClick={() => d.endOf('day') >= now && compose({ at: (d.hasSame(now, 'day') ? now.plus({ hours: 1 }).startOf('hour') : d.set({ hour: 9 })).toISO() })}
                  >
                    <span className="pl-month-num">{d.day}</span>
                    {dayGroups.slice(0, 3).map(g => <GroupCard key={g.id} g={g} compact />)}
                    {dayGroups.length > 3 && <span className="pl-more">+{dayGroups.length - 3} more</span>}
                    {daySlots > 0 && <span className="pl-month-slots">{daySlots} free slot{daySlots === 1 ? '' : 's'}</span>}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="section-card">
              {selectedGroups.length > 0 && (
                <div className="cal-bulk-bar">
                  <span>{selectedGroups.length} selected</span>
                  <button className="btn btn-secondary btn-sm" onClick={bulkDuplicate}>Duplicate</button>
                  <button className="btn btn-danger btn-sm" onClick={bulkDelete}>Delete</button>
                </div>
              )}
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th></th><th>When</th><th>Accounts</th><th>Post</th><th>Type</th><th>Status</th><th>Author</th><th></th></tr></thead>
                  <tbody>
                    {groups.map(g => (
                      <tr key={g.id}>
                        <td><input type="checkbox" checked={selectedGroups.includes(g.id)} onChange={() => setSelectedGroups(s => s.includes(g.id) ? s.filter(x => x !== g.id) : [...s, g.id])} /></td>
                        <td>{g.at ? g.at.toFormat('ccc d LLL, HH:mm') : '—'}</td>
                        <td><span className="pl-card-accounts">{g.posts.map(p => accountById[p.account_id] && <AccountAvatar key={p.id} account={accountById[p.account_id]} size={20} />)}</span></td>
                        <td>{preview(g.lead.caption, 60)}</td>
                        <td>{POST_TYPE_LABELS[g.lead.post_type]}</td>
                        <td><span className={`status-badge status-${g.status}`}>{STATUS_LABELS[g.status]}</span></td>
                        <td>{g.lead.profiles?.name || '—'}</td>
                        <td>
                          {g.status === 'posted' && g.lead.external_post_url
                            ? <a className="btn btn-secondary btn-sm" href={g.lead.external_post_url} target="_blank" rel="noopener noreferrer">View</a>
                            : <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/social/composer/${g.lead.id}`)}>Edit</button>}
                        </td>
                      </tr>
                    ))}
                    {!groups.length && <tr><td colSpan={8}><EmptyState title="Nothing planned in this range">Create a post or fill your queue.</EmptyState></td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* ── To do ── */}
        <aside className="pl-side">
          <div className="pl-side-section">
            <div className="pl-side-title">Failed <span>{todo.failed.length}</span></div>
            {todo.failed.length === 0 ? <p className="pl-side-empty">Nothing failed.</p> : todo.failed.map(p => (
              <div key={p.id} className="pl-side-item error">
                <div className="pl-side-row">{accountById[p.account_id] && <AccountAvatar account={accountById[p.account_id]} size={18} />}<span>{preview(p.caption, 50)}</span></div>
                <div className="pl-side-err">{p.publish_error}</div>
                <div className="pl-side-actions">
                  <button className="btn btn-primary btn-sm" onClick={() => retry(p)} disabled={busyId === p.id}>{busyId === p.id ? '…' : 'Retry'}</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => postManually(p)}>Post manually</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/social/composer/${p.id}`)}>Edit</button>
                </div>
              </div>
            ))}
          </div>
          <div className="pl-side-section">
            <div className="pl-side-title">Ready to post <span>{todo.ready.length}</span></div>
            {todo.ready.length === 0 ? <p className="pl-side-empty">Assisted-mode posts appear here when they're due.</p> : todo.ready.map(p => (
              <div key={p.id} className="pl-side-item">
                <div className="pl-side-row">{accountById[p.account_id] && <AccountAvatar account={accountById[p.account_id]} size={18} />}<span>{preview(p.caption, 50)}</span></div>
                <div className="pl-side-actions">
                  <button className="btn btn-secondary btn-sm" onClick={() => copyAndOpen(p)}>Copy & open {platformOf(accountById[p.account_id]).name}</button>
                  <button className="btn btn-primary btn-sm" onClick={() => markPosted(p)}>Mark posted</button>
                </div>
              </div>
            ))}
          </div>
          <div className="pl-side-section">
            <div className="pl-side-title">Drafts <span>{todo.drafts.length}</span></div>
            {todo.drafts.length === 0 ? <p className="pl-side-empty">No unscheduled drafts.</p> : todo.drafts.map(p => (
              <button key={p.id} className="pl-side-item pl-side-link" onClick={() => navigate(`/social/composer/${p.id}`)}>
                <div className="pl-side-row">{accountById[p.account_id] && <AccountAvatar account={accountById[p.account_id]} size={18} />}<span>{preview(p.caption, 60)}</span></div>
              </button>
            ))}
          </div>
          <div className="pl-legend">
            {['scheduled', 'publishing', 'posted', 'failed', 'pending_approval', 'ready_to_post'].map(s => (
              <span key={s}><span className="pl-status-dot" style={{ background: STATUS_COLORS[s] }} />{STATUS_LABELS[s]}</span>
            ))}
            <span><span className="pl-slot-swatch" />Free queue slot</span>
          </div>
        </aside>
      </div>

      {showQueue && <QueueSettings accounts={accounts} onClose={() => setShowQueue(false)} onSaved={loadAll} showToast={showToast} />}
      {showAutolists && <AutolistsPanel accounts={accounts} profileId={profile?.id} onClose={() => setShowAutolists(false)} onChanged={loadAll} showToast={showToast} />}
      {toast && <div className={`toast toast-${toast.type}`}>{toast.text}</div>}
    </div>
  )
}
