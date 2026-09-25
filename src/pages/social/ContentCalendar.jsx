import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { DateTime } from 'luxon'
import { supabase } from '../../lib/supabase'
import '../Dashboard.css'
import './ContentLibrary.css'
import './ContentCalendar.css'

const STATUS_LABELS = {
  draft: 'Draft',
  pending_approval: 'Pending Approval',
  changes_requested: 'Changes Requested',
  scheduled: 'Scheduled',
  ready_to_post: 'Ready to Post',
  posted: 'Posted',
  failed: 'Failed',
}

function captionPreview(caption, len = 60) {
  const text = (caption || '').trim()
  return text.length > len ? `${text.slice(0, len)}…` : text || '(No caption)'
}

export default function ContentCalendar() {
  const navigate = useNavigate()
  const [viewMode, setViewMode] = useState('month')
  const [anchorDate, setAnchorDate] = useState(DateTime.now())
  const [posts, setPosts] = useState([])
  const [readyPosts, setReadyPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [colorBy, setColorBy] = useState('pillar')
  const [statusFilter, setStatusFilter] = useState('all')
  const [pillarFilter, setPillarFilter] = useState('all')
  const [campaignFilter, setCampaignFilter] = useState('all')
  const [authorFilter, setAuthorFilter] = useState('all')
  const [pillars, setPillars] = useState([])
  const [campaigns, setCampaigns] = useState([])
  const [authors, setAuthors] = useState([])
  const [dayDetailDate, setDayDetailDate] = useState(null)
  const [draggedPostId, setDraggedPostId] = useState(null)
  const [selectedIds, setSelectedIds] = useState([])
  const [postingId, setPostingId] = useState(null)
  const [toast, setToast] = useState({ show: false, type: '', text: '' })

  useEffect(() => { fetchLookups() }, [])
  useEffect(() => { fetchPosts() }, [viewMode, anchorDate])
  useEffect(() => { fetchReadyPosts() }, [])

  useEffect(() => {
    if (toast.show) {
      const t = setTimeout(() => setToast({ show: false, type: '', text: '' }), 4000)
      return () => clearTimeout(t)
    }
  }, [toast.show])

  function showToast(type, text) { setToast({ show: true, type, text }) }

  async function fetchLookups() {
    const [p, c, a] = await Promise.all([
      supabase.from('content_pillars').select('*').order('name'),
      supabase.from('content_campaigns').select('*').order('name'),
      supabase.from('profiles').select('id, name').in('role', ['admin', 'marketing']),
    ])
    if (p.data) setPillars(p.data)
    if (c.data) setCampaigns(c.data)
    if (a.data) setAuthors(a.data)
  }

  function visibleRange() {
    if (viewMode === 'week') {
      return { start: anchorDate.startOf('week'), end: anchorDate.endOf('week') }
    }
    if (viewMode === 'list') return null
    return { start: anchorDate.startOf('month').startOf('week'), end: anchorDate.endOf('month').endOf('week') }
  }

  async function fetchPosts() {
    setLoading(true)
    let query = supabase.from('posts')
      .select('*, content_pillars(id, name, color), content_campaigns(id, name), profiles(id, name)')
      .eq('is_template', false)

    const range = visibleRange()
    if (range) {
      query = query.gte('scheduled_at', range.start.toISO()).lte('scheduled_at', range.end.toISO())
    }
    query = query.order('scheduled_at', { ascending: true, nullsFirst: true })

    const { data, error } = await query
    if (!error && data) setPosts(data)
    setLoading(false)
  }

  async function fetchReadyPosts() {
    const { data } = await supabase.from('posts')
      .select('*, post_assets(content_assets(id, file_name, file_path, file_type))')
      .eq('status', 'ready_to_post')
      .order('scheduled_at', { ascending: true })
    if (data) setReadyPosts(data)
  }

  const filteredPosts = useMemo(() => posts.filter(p => {
    if (statusFilter !== 'all' && p.status !== statusFilter) return false
    if (pillarFilter !== 'all' && p.pillar_id !== pillarFilter) return false
    if (campaignFilter !== 'all' && p.campaign_id !== campaignFilter) return false
    if (authorFilter !== 'all' && p.created_by !== authorFilter) return false
    return true
  }), [posts, statusFilter, pillarFilter, campaignFilter, authorFilter])

  function colorFor(post) {
    if (colorBy === 'status') {
      const map = { draft: '#9ca3af', pending_approval: '#b45309', changes_requested: '#EC3013', scheduled: '#1d4ed8', ready_to_post: '#7c3aed', posted: '#15803d', failed: '#EC3013' }
      return map[post.status] || '#9ca3af'
    }
    return post.content_pillars?.color || '#9ca3af'
  }

  function gridDays() {
    const range = visibleRange()
    if (!range) return []
    const days = []
    let cur = range.start
    while (cur <= range.end) { days.push(cur); cur = cur.plus({ days: 1 }) }
    return days
  }

  function postsForDay(day) {
    return filteredPosts.filter(p => p.scheduled_at && DateTime.fromISO(p.scheduled_at).hasSame(day, 'day'))
  }

  function navigate_(delta) {
    if (viewMode === 'week') setAnchorDate(prev => prev.plus({ weeks: delta }))
    else setAnchorDate(prev => prev.plus({ months: delta }))
  }

  // ── Drag & drop rescheduling ──
  function handleDragStart(post) { if (post.status === 'scheduled') setDraggedPostId(post.id) }

  async function handleDropOnDay(day) {
    if (!draggedPostId) return
    const post = posts.find(p => p.id === draggedPostId)
    setDraggedPostId(null)
    if (!post) return
    const original = post.scheduled_at ? DateTime.fromISO(post.scheduled_at) : day
    const newDate = day.set({ hour: original.hour, minute: original.minute })
    const { error } = await supabase.from('posts').update({ scheduled_at: newDate.toISO() }).eq('id', post.id)
    if (error) { showToast('error', 'Failed to reschedule'); return }
    showToast('success', 'Post rescheduled')
    fetchPosts()
  }

  // ── Ready to Post actions ──
  async function handlePostNow(post) {
    setPostingId(post.id)
    const text = [post.caption, (post.hashtags || []).map(h => `#${h}`).join(' ')].filter(Boolean).join('\n\n')
    try { await navigator.clipboard?.writeText(text) } catch { /* clipboard may be unavailable */ }

    const assets = (post.post_assets || []).map(pa => pa.content_assets).filter(Boolean)
    if (assets.length > 0) {
      const paths = assets.map(a => a.file_path)
      const { data: signed } = await supabase.storage.from('content-library').createSignedUrls(paths, 300)
      signed?.forEach(s => {
        if (s.signedUrl) {
          const a = document.createElement('a')
          a.href = s.signedUrl
          a.download = ''
          document.body.appendChild(a)
          a.click()
          a.remove()
        }
      })
    }
    window.open('https://www.linkedin.com/feed/', '_blank', 'noopener,noreferrer')
    showToast('success', 'Caption copied — paste it into LinkedIn')
    setPostingId(null)
  }

  async function handleMarkPosted(postId) {
    const { error } = await supabase.from('posts').update({ status: 'posted', posted_at: new Date().toISOString() }).eq('id', postId)
    if (error) { showToast('error', 'Failed to update'); return }
    showToast('success', 'Marked as posted')
    setReadyPosts(prev => prev.filter(p => p.id !== postId))
    fetchPosts()
  }

  // ── List view bulk actions ──
  function toggleSelect(id) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function bulkDelete() {
    if (selectedIds.length === 0) return
    if (!window.confirm(`Delete ${selectedIds.length} post(s)? This cannot be undone.`)) return
    await supabase.from('posts').delete().in('id', selectedIds)
    setSelectedIds([])
    showToast('success', 'Posts deleted')
    fetchPosts()
  }

  async function bulkReassignPillar(pillarId) {
    if (selectedIds.length === 0) return
    await supabase.from('posts').update({ pillar_id: pillarId || null }).in('id', selectedIds)
    setSelectedIds([])
    showToast('success', 'Pillar updated')
    fetchPosts()
  }

  async function bulkDuplicate() {
    if (selectedIds.length === 0) return
    const toDuplicate = posts.filter(p => selectedIds.includes(p.id))
    for (const p of toDuplicate) {
      const { data: newPost } = await supabase.from('posts').insert({
        account_id: p.account_id, post_type: p.post_type, caption: p.caption, hashtags: p.hashtags,
        mentions: p.mentions, pillar_id: p.pillar_id, campaign_id: p.campaign_id, status: 'draft',
        mode: p.mode, poll_options: p.poll_options, created_by: p.created_by,
      }).select().single()
      if (newPost) {
        const { data: srcAssets } = await supabase.from('post_assets').select('asset_id, position').eq('post_id', p.id)
        if (srcAssets && srcAssets.length > 0) {
          await supabase.from('post_assets').insert(srcAssets.map(a => ({ post_id: newPost.id, asset_id: a.asset_id, position: a.position })))
        }
      }
    }
    setSelectedIds([])
    showToast('success', 'Posts duplicated as drafts')
    fetchPosts()
  }

  const dayDetailPosts = dayDetailDate ? filteredPosts.filter(p => p.scheduled_at && DateTime.fromISO(p.scheduled_at).hasSame(dayDetailDate, 'day')) : []

  return (
    <div className="calendar-page">
      <div className="page-header dash-header">
        <div>
          <h1 className="page-title">Content Calendar</h1>
          <p className="page-subtitle">{filteredPosts.length} post{filteredPosts.length !== 1 ? 's' : ''} in view</p>
        </div>
        <div className="dash-header-actions">
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/social/bulk-schedule')}>Bulk Schedule</button>
          <button className="btn btn-primary btn-sm" onClick={() => navigate('/social/composer')}>New Post</button>
        </div>
      </div>

      {/* ── Ready to Post ── */}
      {readyPosts.length > 0 && (
        <div className="section-card ready-section">
          <div className="section-card-header"><h2 className="section-card-title">Ready to Post ({readyPosts.length})</h2></div>
          <div className="ready-list">
            {readyPosts.map(post => (
              <div key={post.id} className="ready-item">
                <div className="ready-item-caption">{captionPreview(post.caption, 90)}</div>
                <div className="ready-item-actions">
                  <button className="btn btn-secondary btn-sm" onClick={() => handlePostNow(post)} disabled={postingId === post.id}>
                    {postingId === post.id ? 'Preparing…' : 'Copy & Open LinkedIn'}
                  </button>
                  <button className="btn btn-primary btn-sm" onClick={() => handleMarkPosted(post.id)}>Mark as Posted</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="cal-toolbar">
        <div className="cal-view-toggle">
          {['month', 'week', 'list'].map(v => (
            <button key={v} className={`lib-type-pill ${viewMode === v ? 'active' : ''}`} onClick={() => setViewMode(v)}>{v.charAt(0).toUpperCase() + v.slice(1)}</button>
          ))}
        </div>
        {viewMode !== 'list' && (
          <div className="cal-nav">
            <button className="btn btn-secondary btn-sm" onClick={() => navigate_(-1)}>&larr;</button>
            <span className="cal-nav-label">{viewMode === 'week' ? `Week of ${anchorDate.startOf('week').toFormat('d LLL')}` : anchorDate.toFormat('LLLL yyyy')}</span>
            <button className="btn btn-secondary btn-sm" onClick={() => navigate_(1)}>&rarr;</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setAnchorDate(DateTime.now())}>Today</button>
          </div>
        )}
        <div className="cal-filters">
          <select className="form-input" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="all">All Statuses</option>
            {Object.entries(STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <select className="form-input" value={pillarFilter} onChange={e => setPillarFilter(e.target.value)}>
            <option value="all">All Pillars</option>
            {pillars.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className="form-input" value={campaignFilter} onChange={e => setCampaignFilter(e.target.value)}>
            <option value="all">All Campaigns</option>
            {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="form-input" value={authorFilter} onChange={e => setAuthorFilter(e.target.value)}>
            <option value="all">All Authors</option>
            {authors.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          {viewMode !== 'list' && (
            <select className="form-input" value={colorBy} onChange={e => setColorBy(e.target.value)}>
              <option value="pillar">Color by Pillar</option>
              <option value="status">Color by Status</option>
            </select>
          )}
        </div>
      </div>

      {loading ? (
        <div className="skeleton skeleton-card" style={{ height: 400 }} />
      ) : viewMode === 'list' ? (
        <div className="section-card">
          {selectedIds.length > 0 && (
            <div className="cal-bulk-bar">
              <span>{selectedIds.length} selected</span>
              <select className="form-input form-input-sm" defaultValue="" onChange={e => e.target.value && bulkReassignPillar(e.target.value)}>
                <option value="">Reassign pillar…</option>
                {pillars.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button className="btn btn-secondary btn-sm" onClick={bulkDuplicate}>Duplicate</button>
              <button className="btn btn-danger btn-sm" onClick={bulkDelete}>Delete</button>
            </div>
          )}
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr><th></th><th>Scheduled</th><th>Caption</th><th>Type</th><th>Pillar</th><th>Status</th><th>Author</th><th></th></tr>
              </thead>
              <tbody>
                {filteredPosts.map(post => (
                  <tr key={post.id}>
                    <td><input type="checkbox" checked={selectedIds.includes(post.id)} onChange={() => toggleSelect(post.id)} /></td>
                    <td>{post.scheduled_at ? DateTime.fromISO(post.scheduled_at).toFormat('d LLL, HH:mm') : '—'}</td>
                    <td>{captionPreview(post.caption)}</td>
                    <td>{post.post_type}</td>
                    <td>{post.content_pillars?.name || '—'}</td>
                    <td><span className={`status-badge status-${post.status}`}>{STATUS_LABELS[post.status]}</span></td>
                    <td>{post.profiles?.name || '—'}</td>
                    <td><button className="btn btn-secondary btn-sm" onClick={() => navigate(`/social/composer/${post.id}`)}>Edit</button></td>
                  </tr>
                ))}
                {filteredPosts.length === 0 && (
                  <tr><td colSpan={8}><div className="empty-state"><p className="empty-state-desc">No posts match these filters.</p></div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className={`cal-grid ${viewMode === 'week' ? 'cal-grid-week' : ''}`}>
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <div key={d} className="cal-grid-dow">{d}</div>)}
          {gridDays().map(day => {
            const dayPosts = postsForDay(day)
            const isOtherMonth = viewMode === 'month' && day.month !== anchorDate.month
            const isToday = day.hasSame(DateTime.now(), 'day')
            return (
              <div
                key={day.toISODate()}
                className={`cal-day-cell ${isOtherMonth ? 'other-month' : ''} ${isToday ? 'today' : ''}`}
                onDragOver={e => e.preventDefault()}
                onDrop={() => handleDropOnDay(day)}
                onClick={() => setDayDetailDate(day)}
              >
                <span className="cal-day-number">{day.day}</span>
                <div className="cal-day-posts">
                  {dayPosts.slice(0, 3).map(post => (
                    <div
                      key={post.id}
                      className="cal-post-chip"
                      style={{ borderLeftColor: colorFor(post) }}
                      draggable={post.status === 'scheduled'}
                      onDragStart={e => { e.stopPropagation(); handleDragStart(post) }}
                      onClick={e => { e.stopPropagation(); navigate(`/social/composer/${post.id}`) }}
                      title={post.caption}
                    >
                      {captionPreview(post.caption, 30)}
                    </div>
                  ))}
                  {dayPosts.length > 3 && <div className="cal-more">+{dayPosts.length - 3} more</div>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Day detail panel */}
      {dayDetailDate && (
        <div className="modal-overlay" onClick={() => setDayDetailDate(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">{dayDetailDate.toFormat('cccc, d LLLL yyyy')}</h3>
            {dayDetailPosts.length === 0 ? (
              <p className="modal-subtitle">No posts scheduled for this day.</p>
            ) : (
              <div className="ready-list">
                {dayDetailPosts.map(post => (
                  <div key={post.id} className="ready-item" onClick={() => navigate(`/social/composer/${post.id}`)} style={{ cursor: 'pointer' }}>
                    <div>
                      <div className="ready-item-caption">{captionPreview(post.caption, 80)}</div>
                      <span className={`status-badge status-${post.status}`}>{STATUS_LABELS[post.status]}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={() => navigate('/social/composer')}>+ New Post</button>
              <button className="btn btn-secondary" onClick={() => setDayDetailDate(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {toast.show && <div className={`toast toast-${toast.type}`}>{toast.text}</div>}
    </div>
  )
}
