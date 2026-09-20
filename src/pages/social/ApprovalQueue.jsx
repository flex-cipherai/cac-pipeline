import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { DateTime } from 'luxon'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import './ContentLibrary.css'
import './ApprovalQueue.css'

function captionPreview(caption, len = 140) {
  const text = (caption || '').trim()
  return text.length > len ? `${text.slice(0, len)}…` : text || '(No caption)'
}

export default function ApprovalQueue() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'

  const [pending, setPending] = useState([])
  const [mine, setMine] = useState([])
  const [loading, setLoading] = useState(true)
  const [decisionPost, setDecisionPost] = useState(null)
  const [decisionAction, setDecisionAction] = useState('')
  const [decisionComment, setDecisionComment] = useState('')
  const [deciding, setDeciding] = useState(false)
  const [historyPost, setHistoryPost] = useState(null)
  const [history, setHistory] = useState([])
  const [toast, setToast] = useState({ show: false, type: '', text: '' })

  useEffect(() => { fetchQueue() }, [])

  useEffect(() => {
    if (toast.show) {
      const t = setTimeout(() => setToast({ show: false, type: '', text: '' }), 4000)
      return () => clearTimeout(t)
    }
  }, [toast.show])

  function showToast(type, text) { setToast({ show: true, type, text }) }

  async function fetchQueue() {
    setLoading(true)
    const { data } = await supabase
      .from('posts')
      .select('*, content_pillars(name), content_campaigns(name), profiles(id, name)')
      .in('status', ['pending_approval', 'changes_requested'])
      .order('created_at', { ascending: true })

    if (data) {
      if (isAdmin) setPending(data.filter(p => p.status === 'pending_approval'))
      setMine(data.filter(p => p.created_by === profile?.id))
    }
    setLoading(false)
  }

  function openDecision(post, action) {
    setDecisionPost(post)
    setDecisionAction(action)
    setDecisionComment('')
  }

  async function submitDecision() {
    if (!decisionPost || !decisionAction) return
    setDeciding(true)
    try {
      await supabase.from('post_approval_history').insert({
        post_id: decisionPost.id, action: decisionAction, comment: decisionComment.trim() || null, actor_id: profile?.id,
      })
      // Approved posts with a scheduled_at go straight to 'scheduled'; otherwise
      // back to 'draft' — same as a rejection (the decision itself stays on the
      // record in post_approval_history either way).
      const finalStatus = decisionAction === 'approved'
        ? (decisionPost.scheduled_at ? 'scheduled' : 'draft')
        : decisionAction === 'changes_requested' ? 'changes_requested' : 'draft'
      await supabase.from('posts').update({ status: finalStatus }).eq('id', decisionPost.id)

      await supabase.functions.invoke('sm-notify-event', {
        body: { event: 'approval_decision', post_id: decisionPost.id, actor_id: profile?.id, decision: decisionAction, comment: decisionComment.trim() },
      }).catch(() => {})

      showToast('success', 'Decision recorded')
      setDecisionPost(null)
      fetchQueue()
    } catch (err) {
      showToast('error', 'Failed to record decision')
    } finally {
      setDeciding(false)
    }
  }

  async function openHistory(post) {
    setHistoryPost(post)
    const { data } = await supabase
      .from('post_approval_history')
      .select('*, profiles(name)')
      .eq('post_id', post.id)
      .order('created_at', { ascending: false })
    setHistory(data || [])
  }

  if (loading) {
    return (
      <div>
        <div className="page-header"><h1 className="page-title">Approval Queue</h1></div>
        <div className="skeleton skeleton-card" style={{ height: 200 }} />
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Approval Queue</h1>
        <p className="page-subtitle">{isAdmin ? `${pending.length} post(s) awaiting your decision` : `${mine.length} of your submission(s) in review`}</p>
      </div>

      {isAdmin && (
        <div className="section-card">
          <div className="section-card-header"><h2 className="section-card-title">Awaiting Your Approval</h2></div>
          {pending.length === 0 ? (
            <div className="empty-state"><p className="empty-state-desc">Nothing waiting for review.</p></div>
          ) : (
            <div className="aq-list">
              {pending.map(post => (
                <div key={post.id} className="aq-item">
                  <div className="aq-item-main">
                    <div className="aq-item-caption">{captionPreview(post.caption)}</div>
                    <div className="aq-item-meta">
                      Submitted by {post.profiles?.name || 'Unknown'} · {post.content_pillars?.name || 'No pillar'}
                      {post.scheduled_at && ` · Scheduled for ${DateTime.fromISO(post.scheduled_at).toFormat('d LLL, HH:mm')}`}
                    </div>
                  </div>
                  <div className="aq-item-actions">
                    <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/social/composer/${post.id}`)}>View</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => openDecision(post, 'changes_requested')}>Request Changes</button>
                    <button className="btn btn-danger btn-sm" onClick={() => openDecision(post, 'rejected')}>Reject</button>
                    <button className="btn btn-primary btn-sm" onClick={() => openDecision(post, 'approved')}>Approve</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="section-card">
        <div className="section-card-header"><h2 className="section-card-title">My Submissions</h2></div>
        {mine.length === 0 ? (
          <div className="empty-state"><p className="empty-state-desc">You have nothing in review right now.</p></div>
        ) : (
          <div className="aq-list">
            {mine.map(post => (
              <div key={post.id} className="aq-item">
                <div className="aq-item-main">
                  <div className="aq-item-caption">{captionPreview(post.caption)}</div>
                  <span className={`status-badge status-${post.status}`}>{post.status.replace(/_/g, ' ')}</span>
                </div>
                <div className="aq-item-actions">
                  <button className="btn btn-secondary btn-sm" onClick={() => openHistory(post)}>History</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/social/composer/${post.id}`)}>Edit</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {decisionPost && (
        <div className="modal-overlay" onClick={() => !deciding && setDecisionPost(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">{decisionAction === 'approved' ? 'Approve Post' : decisionAction === 'rejected' ? 'Reject Post' : 'Request Changes'}</h3>
            <p className="modal-subtitle">{captionPreview(decisionPost.caption, 100)}</p>
            <div className="form-group">
              <label className="form-label">Comment {decisionAction !== 'approved' ? '(required)' : '(optional)'}</label>
              <textarea className="form-input" rows={3} value={decisionComment} onChange={e => setDecisionComment(e.target.value)} placeholder="Add context for the author…" />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setDecisionPost(null)} disabled={deciding}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={submitDecision}
                disabled={deciding || (decisionAction !== 'approved' && !decisionComment.trim())}
              >
                {deciding ? 'Saving…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {historyPost && (
        <div className="modal-overlay" onClick={() => setHistoryPost(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Approval History</h3>
            {history.length === 0 ? (
              <p className="modal-subtitle">No history yet.</p>
            ) : (
              <div className="aq-history-list">
                {history.map(h => (
                  <div key={h.id} className="aq-history-item">
                    <span className={`status-badge status-${h.action === 'submitted' ? 'pending_approval' : h.action === 'approved' ? 'posted' : h.action === 'rejected' ? 'failed' : 'changes_requested'}`}>{h.action.replace(/_/g, ' ')}</span>
                    <span className="aq-history-meta">{h.profiles?.name || 'Unknown'} · {DateTime.fromISO(h.created_at).toFormat('d LLL, HH:mm')}</span>
                    {h.comment && <p className="aq-history-comment">{h.comment}</p>}
                  </div>
                ))}
              </div>
            )}
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={() => setHistoryPost(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {toast.show && <div className={`toast toast-${toast.type}`}>{toast.text}</div>}
    </div>
  )
}
