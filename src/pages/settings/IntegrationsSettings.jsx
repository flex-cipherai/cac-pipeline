import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { SettingsHeading } from './SettingsLayout'
import useToast from './useToast'

const quietBadge = { marginLeft: 6, color: 'var(--text-secondary)', background: 'var(--bg-gray)' }

export default function IntegrationsSettings() {
  const { showToast, toast } = useToast()
  const [loading, setLoading] = useState(true)

  // LinkedIn
  const [connectedAccount, setConnectedAccount] = useState(null)
  const [accountNameDraft, setAccountNameDraft] = useState('')
  const [savingAccount, setSavingAccount] = useState(false)
  const [connectingLinkedIn, setConnectingLinkedIn] = useState(false)

  // Google Search Console (Website Analytics → Search tab). Access is by service account (Edge Function
  // secret); only the property is set here.
  const [gscSiteUrl, setGscSiteUrl] = useState('')
  const [gscStatus, setGscStatus] = useState({ lastSyncAt: '', status: '' })
  const [savingGsc, setSavingGsc] = useState(false)
  const [checkingGsc, setCheckingGsc] = useState(false)
  const [gscCheck, setGscCheck] = useState(null)

  useEffect(() => { fetchData() }, [])

  // Handle the redirect back from sm-linkedin-oauth-callback (?linkedin=connected|connected_pending_api_approval|error)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const linkedinStatus = params.get('linkedin')
    if (!linkedinStatus) return

    if (linkedinStatus === 'connected') {
      showToast('success', 'LinkedIn connected — Automated Mode is now active')
    } else if (linkedinStatus === 'connected_pending_api_approval') {
      showToast('success', 'LinkedIn account linked. Publishing stays in Assisted Mode until LinkedIn approves API access.')
    } else if (linkedinStatus === 'error') {
      showToast('error', params.get('detail') || 'Failed to connect LinkedIn')
    }

    params.delete('linkedin')
    params.delete('detail')
    const newSearch = params.toString()
    window.history.replaceState({}, '', window.location.pathname + (newSearch ? `?${newSearch}` : ''))
  }, [])

  async function fetchData() {
    const [accountRes, gscRes] = await Promise.all([
      supabase.from('connected_accounts').select('*').eq('platform', 'linkedin').maybeSingle(),
      supabase.from('system_settings').select('key, value').in('key', ['gsc_site_url', 'gsc_last_sync_at', 'gsc_last_sync_status']),
    ])
    if (accountRes.data) { setConnectedAccount(accountRes.data); setAccountNameDraft(accountRes.data.account_name) }
    if (gscRes.data) {
      const get = k => gscRes.data.find(r => r.key === k)?.value || ''
      setGscSiteUrl(get('gsc_site_url'))
      setGscStatus({ lastSyncAt: get('gsc_last_sync_at'), status: get('gsc_last_sync_status') })
    }
    setLoading(false)
  }

  // ── LinkedIn ──
  async function saveAccountName() {
    if (!connectedAccount || !accountNameDraft.trim()) return
    setSavingAccount(true)
    const { error } = await supabase.from('connected_accounts').update({ account_name: accountNameDraft.trim() }).eq('id', connectedAccount.id)
    setSavingAccount(false)
    if (error) { showToast('error', 'Failed to update account'); return }
    setConnectedAccount(prev => ({ ...prev, account_name: accountNameDraft.trim() }))
    showToast('success', 'Account updated')
  }

  async function connectLinkedIn() {
    setConnectingLinkedIn(true)
    try {
      const { data, error } = await supabase.functions.invoke('sm-linkedin-oauth-start', {
        body: { redirect_origin: window.location.origin },
      })
      if (error) throw new Error('Could not reach the server. Please try again.')
      if (!data?.success) throw new Error(data?.error || 'Failed to start LinkedIn connection')
      window.location.href = data.url
    } catch (err) {
      showToast('error', err.message || 'Failed to start LinkedIn connection')
      setConnectingLinkedIn(false)
    }
  }

  async function toggleAccountStatus() {
    if (!connectedAccount) return
    const newStatus = connectedAccount.status === 'active' ? 'disconnected' : 'active'
    const { error } = await supabase.from('connected_accounts').update({ status: newStatus }).eq('id', connectedAccount.id)
    if (error) { showToast('error', 'Failed to update status'); return }
    setConnectedAccount(prev => ({ ...prev, status: newStatus }))
    showToast('success', newStatus === 'active' ? 'Account reactivated' : 'Account disconnected')
  }

  // ── Google Search Console ──
  async function saveGscSite() {
    setSavingGsc(true)
    const { error } = await supabase.from('system_settings').upsert({ key: 'gsc_site_url', value: gscSiteUrl.trim() }, { onConflict: 'key' })
    setSavingGsc(false)
    if (error) { showToast('error', 'Failed to save Search Console property'); return }
    showToast('success', 'Search Console property saved')
  }

  // Asks the Edge Function which properties the service account can see — confirms the secret is set and
  // the account was added in Search Console.
  async function verifyGscAccess() {
    setCheckingGsc(true)
    setGscCheck(null)
    try {
      const { data, error } = await supabase.functions.invoke('sm-gsc-sync', { body: { action: 'list_sites' } })
      if (error) throw new Error('Could not reach sm-gsc-sync. Has it been deployed?')
      if (!data?.success) throw new Error(data?.error || 'Verification failed')
      setGscCheck({ email: data.service_account_email, sites: data.sites || [] })
    } catch (err) {
      setGscCheck({ error: err.message })
    } finally {
      setCheckingGsc(false)
    }
  }

  if (loading) {
    return (
      <div>
        <SettingsHeading title="Integrations" />
        <div className="skeleton skeleton-card" style={{ height: 200 }} />
      </div>
    )
  }

  return (
    <div>
      <SettingsHeading title="Integrations" hint="The LinkedIn page posts are published to, and the Google Search Console property behind Website Analytics." />

      <div className="section-card" style={{ padding: 'var(--space-lg)' }}>
        {connectedAccount ? (
          <>
            <div className="sm-account-row">
              <div>
                <div className="sm-account-platform">LinkedIn Company Page</div>
                <span className={`status-badge status-${connectedAccount.status === 'active' ? 'posted' : 'draft'}`}>{connectedAccount.status === 'active' ? 'Active' : 'Disconnected'}</span>
                <span className="status-badge" style={quietBadge}>
                  {connectedAccount.mode === 'automated' ? 'Automated Mode' : 'Assisted Mode'}
                </span>
                {connectedAccount.oauth_connected && connectedAccount.mode !== 'automated' && (
                  <span className="status-badge" style={quietBadge}>Linked — awaiting API approval</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary btn-sm" onClick={connectLinkedIn} disabled={connectingLinkedIn}>
                  {connectingLinkedIn ? 'Redirecting...' : connectedAccount.oauth_connected ? 'Reconnect LinkedIn' : 'Connect LinkedIn'}
                </button>
                <button className="btn btn-secondary btn-sm" onClick={toggleAccountStatus}>
                  {connectedAccount.status === 'active' ? 'Disconnect' : 'Reactivate'}
                </button>
              </div>
            </div>
            <div className="profile-edit-grid" style={{ marginTop: 'var(--space-md)' }}>
              <div className="form-group">
                <label className="form-label">Account Name</label>
                <input className="form-input" value={accountNameDraft} onChange={e => setAccountNameDraft(e.target.value)} />
              </div>
            </div>
            <p className="form-hint">
              {connectedAccount.mode === 'automated'
                ? 'LinkedIn is connected via API — publishing and analytics run automatically.'
                : connectedAccount.oauth_connected
                  ? "Your LinkedIn account is linked, but LinkedIn hasn't approved Community Management API access yet — publishing and analytics stay manual (Assisted Mode) until then. This switches automatically once approved."
                  : "Connect LinkedIn to enable Automated Mode once LinkedIn approves API access. Until then, and even after connecting, publishing stays manual (Assisted Mode) as long as approval is pending."}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-sm)' }}>
              <button className="btn btn-primary btn-sm" onClick={saveAccountName} disabled={savingAccount}>{savingAccount ? 'Saving...' : 'Save'}</button>
            </div>
          </>
        ) : (
          <p className="form-hint">No LinkedIn account connected yet.</p>
        )}
      </div>

      <div className="section-card" style={{ padding: 'var(--space-lg)', marginTop: 'var(--space-md)' }}>
        <div className="sm-account-row">
          <div>
            <div className="sm-account-platform">Google Search Console</div>
            <span className={`status-badge status-${gscSiteUrl ? 'posted' : 'draft'}`}>{gscSiteUrl ? 'Property set' : 'Not configured'}</span>
            {gscStatus.status && (
              <span className="status-badge" style={quietBadge}>
                {gscStatus.status === 'ok' ? 'Last sync OK' : 'Last sync failed'}
              </span>
            )}
          </div>
          <button className="btn btn-secondary btn-sm" onClick={verifyGscAccess} disabled={checkingGsc}>
            {checkingGsc ? 'Checking...' : 'Verify access'}
          </button>
        </div>
        <div className="profile-edit-grid" style={{ marginTop: 'var(--space-md)' }}>
          <div className="form-group">
            <label className="form-label">Search Console property</label>
            <input className="form-input" value={gscSiteUrl} onChange={e => setGscSiteUrl(e.target.value)} placeholder="sc-domain:sdfmgroup.com  or  https://sdfmgroup.com/" />
          </div>
        </div>
        <p className="form-hint">
          Feeds the Search (SEO) tab of Website Analytics. Use <code>sc-domain:yourdomain.com</code> for a Domain property, or the full URL with a trailing slash for a URL-prefix property — exactly as Search Console lists it.
          {gscStatus.lastSyncAt && <> Last synced {new Date(gscStatus.lastSyncAt).toLocaleString()}.</>}
          {gscStatus.status && gscStatus.status !== 'ok' && <> <strong>{gscStatus.status}</strong></>}
        </p>
        {gscCheck?.error && <p className="form-hint" style={{ color: 'var(--sdfm-red)' }}>{gscCheck.error}</p>}
        {gscCheck?.email && (
          <p className="form-hint">
            Service account: <strong>{gscCheck.email}</strong>.{' '}
            {gscCheck.sites.length === 0
              ? 'It cannot see any properties yet — add this email as a user in Search Console → Settings → Users and permissions.'
              : <>Can access: {gscCheck.sites.map(s => s.siteUrl).join(', ')}{gscSiteUrl && !gscCheck.sites.some(s => s.siteUrl === gscSiteUrl.trim()) ? <strong> — the property above is not in this list.</strong> : '.'}</>}
          </p>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-sm)' }}>
          <button className="btn btn-primary btn-sm" onClick={saveGscSite} disabled={savingGsc}>{savingGsc ? 'Saving...' : 'Save'}</button>
        </div>
      </div>

      {toast}
    </div>
  )
}
