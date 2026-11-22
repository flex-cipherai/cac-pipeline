import { useEffect, useMemo, useState } from 'react'
import { DateTime } from 'luxon'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { useSocialAccounts } from '../../lib/socialAccounts'
import { capabilitiesOf, platformOf } from '../../lib/platforms'
import { AccountBar, AccountAvatar, SocialHeader, EmptyState } from '../../components/social/SocialUI'
import './Inbox.css'

const TYPE_LABELS = { comment: 'Comment', reaction: 'Reaction', mention: 'Mention', follower_milestone: 'Milestone' }
const OTHER = '__other__'

function rel(iso) {
  const d = DateTime.fromISO(iso)
  return d > DateTime.now().minus({ days: 6 }) ? d.toRelative() : d.toFormat('d LLL yyyy')
}

// Inbox (Metricool-style): comments synced from every connected network,
// grouped into one conversation per post, answered in place (sm-reply posts
// the reply on the network as the account). Mentions, reactions and
// milestones logged by hand or synced sit under "Other activity".
export default function Inbox() {
  const { profile } = useAuth()
  const { accounts, selected, selectedIds, setSelected, loading: accountsLoading } = useSocialAccounts()
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('needs_response')
  const [openKey, setOpenKey] = useState(null)
  const [drafts, setDrafts] = useState({})
  const [sending, setSending] = useState(null)
  const [showLog, setShowLog] = useState(false)
  const [newEvent, setNewEvent] = useState({ account_id: '', event_type: 'comment', content: '', author_name: '', occurred_at: DateTime.now().toFormat("yyyy-LL-dd'T'HH:mm"), external_url: '' })
  const [toast, setToast] = useState(null)

  const accountById = useMemo(() => Object.fromEntries(accounts.map(a => [a.id, a])), [accounts])

  function showToast(type, text) { setToast({ type, text }); setTimeout(() => setToast(null), 4500) }

  useEffect(() => { if (!accountsLoading) load() }, [accountsLoading, selectedIds.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true)
    const ids = selectedIds.length ? selectedIds : ['00000000-0000-0000-0000-000000000000']
    const { data } = await supabase.from('activity_events')
      .select('*, posts(id, caption, external_post_url, posted_at)')
      .or(`account_id.in.(${ids.join(',')}),account_id.is.null`)
      .order('occurred_at', { ascending: false })
      .limit(500)
    setEvents(data || [])
    setLoading(false)
  }

  // Conversations: one per post (+ "Other activity").
  const conversations = useMemo(() => {
    const map = new Map()
    for (const e of events) {
      const key = e.event_type === 'comment' && e.post_id ? e.post_id : OTHER
      const c = map.get(key) || { key, post: e.posts, account_id: e.account_id, events: [], open: 0, latest: e.occurred_at }
      c.events.push(e)
      if (e.direction !== 'outbound' && e.triage_status === 'needs_response') c.open++
      if (e.occurred_at > c.latest) c.latest = e.occurred_at
      map.set(key, c)
    }
    const hourAgo = DateTime.now().minus({ hours: 1 }).toISO()
    return [...map.values()]
      .map(c => ({ ...c, spike: c.events.filter(e => e.direction !== 'outbound' && e.occurred_at >= hourAgo).length >= 3 }))
      .filter(c => filter === 'all' || (filter === 'needs_response' ? c.open > 0 : c.open === 0))
      .sort((a, b) => (b.spike - a.spike) || b.latest.localeCompare(a.latest))
  }, [events, filter])

  const totalOpen = useMemo(() => events.filter(e => e.direction !== 'outbound' && e.triage_status === 'needs_response').length, [events])
  const active = conversations.find(c => c.key === openKey) || conversations[0]

  async function triage(e, status) {
    await supabase.from('activity_events').update({ triage_status: status }).eq('id', e.id)
    setEvents(prev => prev.map(x => x.id === e.id ? { ...x, triage_status: status } : x))
  }

  async function markAll(conv, status) {
    const ids = conv.events.filter(e => e.direction !== 'outbound' && e.triage_status === 'needs_response').map(e => e.id)
    if (!ids.length) return
    await supabase.from('activity_events').update({ triage_status: status }).in('id', ids)
    setEvents(prev => prev.map(x => ids.includes(x.id) ? { ...x, triage_status: status } : x))
  }

  async function sendReply(e) {
    const text = (drafts[e.id] || '').trim()
    if (!text) return
    setSending(e.id)
    const { data, error } = await supabase.functions.invoke('sm-reply', { body: { event_id: e.id, text } })
    setSending(null)
    if (error || !data?.success) { showToast('error', data?.error || 'Reply failed'); return }
    setDrafts(d => ({ ...d, [e.id]: '' }))
    showToast('success', 'Reply posted')
    load()
  }

  async function logEvent() {
    if (!newEvent.content.trim() && newEvent.event_type !== 'follower_milestone') { showToast('error', 'Add a description'); return }
    const { error } = await supabase.from('activity_events').insert({
      account_id: newEvent.account_id || accounts[0]?.id || null,
      event_type: newEvent.event_type, content: newEvent.content.trim() || null,
      author_name: newEvent.author_name.trim() || null, occurred_at: new Date(newEvent.occurred_at).toISOString(),
      external_url: newEvent.external_url.trim() || null, created_by: profile?.id, source: 'manual',
    })
    if (error) { showToast('error', 'Failed to log activity'); return }
    setShowLog(false)
    setNewEvent(n => ({ ...n, content: '', author_name: '', external_url: '' }))
    showToast('success', 'Logged')
    load()
  }

  // Thread order: oldest first, replies under the comment they answer.
  function thread(conv) {
    const sorted = [...conv.events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
    const tops = sorted.filter(e => !(e.direction === 'outbound' || (e.parent_external_id && sorted.some(p => p.external_id === e.parent_external_id && p.id !== e.id))))
    return tops.map(t => ({ top: t, replies: sorted.filter(r => r.id !== t.id && r.parent_external_id && r.parent_external_id === t.external_id) }))
  }

  const activeAccount = active ? accountById[active.account_id] : null
  const canReply = activeAccount && capabilitiesOf(activeAccount).reply

  return (
    <div className="inbox-page">
      <SocialHeader title="Inbox" subtitle={`${totalOpen} waiting for a response`}>
        <button className="btn btn-secondary btn-sm" onClick={() => setShowLog(true)}>Log activity</button>
      </SocialHeader>
      <AccountBar accounts={accounts} selected={selected} onChange={setSelected} />

      <div className="ib-layout">
        <div className="ib-list">
          <div className="sm-tabs ib-filter">
            {[['needs_response', 'To answer'], ['handled', 'Done'], ['all', 'All']].map(([k, l]) => (
              <button key={k} className={`sm-tab ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>
          {loading ? <div className="skeleton skeleton-card" style={{ height: 240 }} /> : conversations.length === 0 ? (
            <EmptyState title={filter === 'needs_response' ? 'All caught up' : 'Nothing here'}>New comments on your posts sync every hour.</EmptyState>
          ) : conversations.map(c => {
            const acc = accountById[c.account_id]
            return (
              <button key={c.key} className={`ib-conv ${active?.key === c.key ? 'on' : ''}`} onClick={() => setOpenKey(c.key)}>
                {acc ? <AccountAvatar account={acc} size={28} /> : <span className="ib-other-icon">★</span>}
                <span className="ib-conv-text">
                  <b>{c.key === OTHER ? 'Other activity' : (c.post?.caption || '(post)').slice(0, 60)}</b>
                  <small>{c.events.length} item{c.events.length === 1 ? '' : 's'} · {rel(c.latest)}</small>
                </span>
                {c.spike && <span className="ib-spike" title="3+ comments in the last hour">🔥</span>}
                {c.open > 0 && <span className="ib-count">{c.open}</span>}
              </button>
            )
          })}
        </div>

        <div className="ib-thread">
          {!active ? <EmptyState title="Select a conversation" /> : (
            <>
              <div className="ib-thread-head">
                <div>
                  <div className="ib-thread-title">{active.key === OTHER ? 'Other activity' : (active.post?.caption || '').slice(0, 140) || '(post)'}</div>
                  {activeAccount && <div className="ib-thread-sub">{platformOf(activeAccount).name} · {activeAccount.account_name}{active.post?.posted_at ? ` · posted ${rel(active.post.posted_at)}` : ''}</div>}
                </div>
                <div className="ib-thread-actions">
                  {active.post?.external_post_url && <a className="btn btn-secondary btn-sm" href={active.post.external_post_url} target="_blank" rel="noopener noreferrer">Open post</a>}
                  {active.open > 0 && <button className="btn btn-secondary btn-sm" onClick={() => markAll(active, 'handled')}>Mark all done</button>}
                </div>
              </div>

              {active.key !== OTHER && !canReply && activeAccount && (
                <p className="ib-note">Replies from the BMS aren't available for {activeAccount.account_name} — answer on {platformOf(activeAccount).name}, then mark done.</p>
              )}

              {(active.key === OTHER ? active.events.map(e => ({ top: e, replies: [] })) : thread(active)).map(({ top: e, replies }) => (
                <div key={e.id} className={`ib-msg ${e.triage_status !== 'needs_response' ? 'done' : ''}`}>
                  <div className="ib-msg-head">
                    <b>{e.author_name || TYPE_LABELS[e.event_type]}</b>
                    <span>{TYPE_LABELS[e.event_type]} · {rel(e.occurred_at)}{e.source === 'manual' ? ' · logged by hand' : ''}</span>
                  </div>
                  {e.content && <div className="ib-msg-text">{e.content}</div>}
                  {replies.map(r => (
                    <div key={r.id} className="ib-reply">
                      <b>{r.author_name}</b> <span>{rel(r.occurred_at)}</span>
                      <div>{r.content}</div>
                    </div>
                  ))}
                  <div className="ib-msg-actions">
                    {e.event_type === 'comment' && e.external_id && canReply && e.direction !== 'outbound' && (
                      <div className="ib-reply-box">
                        <textarea className="form-input" rows={2} placeholder={`Reply as ${activeAccount.account_name}…`} value={drafts[e.id] || ''}
                          onChange={ev => setDrafts(d => ({ ...d, [e.id]: ev.target.value }))}
                          onKeyDown={ev => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) sendReply(e) }} />
                        <button className="btn btn-primary btn-sm" onClick={() => sendReply(e)} disabled={sending === e.id || !(drafts[e.id] || '').trim()}>{sending === e.id ? 'Sending…' : 'Reply'}</button>
                      </div>
                    )}
                    <div className="ib-triage">
                      {e.triage_status === 'needs_response' ? (
                        <>
                          <button className="btn btn-secondary btn-sm" onClick={() => triage(e, 'handled')}>Done</button>
                          <button className="btn btn-secondary btn-sm" onClick={() => triage(e, 'ignored')}>Ignore</button>
                        </>
                      ) : <button className="btn btn-secondary btn-sm" onClick={() => triage(e, 'needs_response')}>Reopen</button>}
                      {e.external_url && active.key === OTHER && <a className="btn btn-secondary btn-sm" href={e.external_url} target="_blank" rel="noopener noreferrer">Open</a>}
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {showLog && (
        <div className="modal-overlay" onClick={() => setShowLog(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Log activity</h3>
            <p className="modal-subtitle">For things the BMS can't sync — mentions, DMs, comments on profile posts.</p>
            <div className="form-group">
              <label className="form-label">Account</label>
              <select className="form-input" value={newEvent.account_id || accounts[0]?.id || ''} onChange={e => setNewEvent(n => ({ ...n, account_id: e.target.value }))}>
                {accounts.map(a => <option key={a.id} value={a.id}>{platformOf(a).name} · {a.account_name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Type</label>
              <select className="form-input" value={newEvent.event_type} onChange={e => setNewEvent(n => ({ ...n, event_type: e.target.value }))}>
                {Object.entries(TYPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            <div className="form-group"><label className="form-label">What happened</label><textarea className="form-input" rows={3} value={newEvent.content} onChange={e => setNewEvent(n => ({ ...n, content: e.target.value }))} /></div>
            <div className="composer-two-col">
              <div className="form-group"><label className="form-label">Who</label><input className="form-input" value={newEvent.author_name} onChange={e => setNewEvent(n => ({ ...n, author_name: e.target.value }))} /></div>
              <div className="form-group"><label className="form-label">When</label><input type="datetime-local" className="form-input" value={newEvent.occurred_at} onChange={e => setNewEvent(n => ({ ...n, occurred_at: e.target.value }))} /></div>
            </div>
            <div className="form-group"><label className="form-label">Link (optional)</label><input className="form-input" value={newEvent.external_url} onChange={e => setNewEvent(n => ({ ...n, external_url: e.target.value }))} /></div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowLog(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={logEvent}>Log</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className={`toast toast-${toast.type}`}>{toast.text}</div>}
    </div>
  )
}
