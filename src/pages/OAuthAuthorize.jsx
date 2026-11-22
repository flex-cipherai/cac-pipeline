import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'

// /oauth/authorize — Claude sends people here when they add the BMS connector.
// Signed-in users see who is asking and choose Allow or Deny; the bms-mcp
// function then issues a one-time code and we return to Claude.
const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bms-mcp`

export default function OAuthAuthorize() {
  const { user, profile, loading } = useAuth()
  const location = useLocation()
  const params = Object.fromEntries(new URLSearchParams(location.search))
  const [client, setClient] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!params.client_id || !params.redirect_uri || params.response_type !== 'code') { setError('This sign-in link is incomplete. Start again from Claude.'); return }
    fetch(`${FN}/oauth/client?client_id=${encodeURIComponent(params.client_id)}&redirect_uri=${encodeURIComponent(params.redirect_uri)}`)
      .then(r => r.json())
      .then(d => (d.client_name && d.redirect_ok ? setClient(d) : setError('This connection request is not recognised. Remove the connector in Claude and add it again.')))
      .catch(() => setError('Could not reach the BMS. Please try again.'))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return null
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />

  async function decide(decision) {
    setBusy(true)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${FN}/oauth/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ ...params, decision }),
    })
    const d = await res.json().catch(() => ({}))
    if (d.redirect) { window.location.href = d.redirect; return }
    setError(d.error_description || 'Something went wrong')
    setBusy(false)
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-gray)', padding: 16 }}>
      <div className="section-card" style={{ maxWidth: 460, width: '100%', padding: 'var(--space-xl)' }}>
        <h1 className="page-title" style={{ fontSize: 'var(--text-xl)' }}>Connect {client?.client_name || 'Claude'} to the BMS</h1>
        {error ? <p style={{ color: 'var(--sdfm-red)' }}>{error}</p> : (
          <>
            <p>Signed in as <b>{profile?.name || user.email}</b>.</p>
            <p className="form-hint">{client?.client_name || 'Claude'} will be able to act as you in the BMS, with your permissions: plan, schedule and publish posts, reply to comments, read analytics, and view and update leads and inquiries. It asks you before each action. You can disconnect any time in Settings → My profile.</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 'var(--space-lg)' }}>
              <button className="btn btn-secondary" onClick={() => decide('deny')} disabled={busy || !client}>Deny</button>
              <button className="btn btn-primary" onClick={() => decide('allow')} disabled={busy || !client}>{busy ? 'Connecting…' : 'Allow'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
