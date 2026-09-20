import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { DateTime } from 'luxon'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import './NotificationBell.css'

const POLL_INTERVAL_MS = 60000

export default function NotificationBell() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!user) return
    fetchNotifications()
    const interval = setInterval(fetchNotifications, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [user])

  useEffect(() => {
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  async function fetchNotifications() {
    const { data } = await supabase
      .from('in_app_notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20)
    if (data) setItems(data)
  }

  const unreadCount = items.filter(i => !i.is_read).length

  async function markRead(item) {
    if (!item.is_read) {
      await supabase.from('in_app_notifications').update({ is_read: true }).eq('id', item.id)
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, is_read: true } : i))
    }
    setOpen(false)
    if (item.link) navigate(item.link)
  }

  async function markAllRead() {
    const unreadIds = items.filter(i => !i.is_read).map(i => i.id)
    if (unreadIds.length === 0) return
    await supabase.from('in_app_notifications').update({ is_read: true }).in('id', unreadIds)
    setItems(prev => prev.map(i => ({ ...i, is_read: true })))
  }

  if (!user) return null

  return (
    <div className="notif-bell-wrap" ref={wrapRef}>
      <button className="notif-bell-trigger" onClick={() => setOpen(!open)} aria-label="Notifications">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 8a6 6 0 1112 0c0 4 1.5 5.5 1.5 5.5h-15S4 12 4 8z" />
          <path d="M8 16a2 2 0 004 0" />
        </svg>
        {unreadCount > 0 && <span className="notif-bell-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>

      {open && (
        <div className="notif-bell-panel">
          <div className="notif-bell-header">
            <span>Notifications</span>
            {unreadCount > 0 && <button className="notif-bell-mark-all" onClick={markAllRead}>Mark all read</button>}
          </div>
          <div className="notif-bell-list">
            {items.length === 0 ? (
              <div className="notif-bell-empty">You're all caught up.</div>
            ) : (
              items.map(item => (
                <button key={item.id} className={`notif-bell-item ${!item.is_read ? 'unread' : ''}`} onClick={() => markRead(item)}>
                  <div className="notif-bell-item-title">{item.title}</div>
                  {item.body && <div className="notif-bell-item-body">{item.body}</div>}
                  <div className="notif-bell-item-time">{DateTime.fromISO(item.created_at).toRelative()}</div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
