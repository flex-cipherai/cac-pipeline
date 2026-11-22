import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { SettingsHeading } from './SettingsLayout'
import { useAuth } from '../../lib/AuthContext'
import useToast from './useToast'
import { PLATFORM_LIST } from '../../lib/platforms'
import { PlatformIcon } from '../../components/social/SocialUI'

const quietBadge = { marginLeft: 6, color: 'var(--text-secondary)', background: 'var(--bg-gray)' }

export default function IntegrationsSettings() {
  const { showToast, toast } = useToast()
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)

  // LinkedIn
  const [pages, setPages] = useState([]) // account_type 'organization' — one per LinkedIn Company Page
  const [connectingLinkedIn, setConnectingLinkedIn] = useState(false)
  const [memberAccounts, setMemberAccounts] = useState([])
  const [syncing, setSyncing] = useState(false)
  const [refreshingPages, setRefreshingPages] = useState(false)
  const [togglingId, setTogglingId] = useState(null)
  const [importingId, setImportingId] = useState(null)
  const [metaAccounts, setMetaAccounts] = useState([]) // Facebook Pages + Instagram accounts
  const [connectingMeta, setConnectingMeta] = useState(false)

  async function connectMeta() {
    setConnectingMeta(true)
    try {
      const { data, error } = await supabase.functions.invoke('sm-meta-oauth-start', { body: { redirect_origin: window.location.origin } })
      if (error) throw new Error('Could not reach the server. Please try again.')
      if (!data?.success) throw new Error(data?.error || 'Failed to start the Meta connection')
      window.location.href = data.url
    } catch (err) {
      showToast('error', err.message)
      setConnectingMeta(false)
    }
  }

  // One-time history import (12 months of daily totals, follower trend and
  // past Company Page posts). Safe to repeat.
  async function importHistory(account) {
    setImportingId(account.id)
    try {
      const { data, error } = await supabase.functions.invoke('sm-import-history', { body: { account_id: account.id } })
      if (error) throw new Error('Could not reach the server. Please try again.')
      if (!data?.success) throw new Error(data?.error || 'Import failed')
      showToast('success', `${account.account_name}: ${data.days} days of analytics${data.posts ? ` and ${data.posts} past posts` : ''} imported`)
      fetchData()
    } catch (err) {
      showToast('error', err.message)
    } finally {
      setImportingId(null)
    }
  }

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
    const metaStatus = params.get('meta')
    if (!linkedinStatus && !metaStatus) return

    if (metaStatus === 'connected') {
      showToast('success', `Meta connected (${params.get('detail') || 'accounts saved'}) — choose below which ones the BMS manages`)
    } else if (metaStatus === 'missing_permissions' || metaStatus === 'connected_no_instagram') {
      showToast('error', params.get('detail') || 'Meta connected only partly')
    } else if (metaStatus === 'error') {
      showToast('error', params.get('detail') || 'Failed to connect Meta')
    }

    if (linkedinStatus === 'connected') {
      showToast('success', 'LinkedIn connected — choose below which Company Pages the BMS manages')
    } else if (linkedinStatus === 'connected_profile_only') {
      showToast('error', `Your profile is connected, but no Company Page was found: ${params.get('detail') || 'no page found'}`)
    } else if (linkedinStatus === 'error') {
      showToast('error', params.get('detail') || 'Failed to connect LinkedIn')
    }

    params.delete('linkedin')
    params.delete('meta')
    params.delete('detail')
    const newSearch = params.toString()
    window.history.replaceState({}, '', window.location.pathname + (newSearch ? `?${newSearch}` : ''))
  }, [])

  async function fetchData() {
    const [accountRes, gscRes] = await Promise.all([
      supabase.from('connected_accounts').select('*').order('created_at'),
      supabase.from('system_settings').select('key, value').in('key', ['gsc_site_url', 'gsc_last_sync_at', 'gsc_last_sync_status']),
    ])
    if (accountRes.data) {
      const byManagedThenName = (a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || a.account_name.localeCompare(b.account_name)
      setMetaAccounts(accountRes.data.filter(a => ['facebook', 'instagram'].includes(a.platform))
        .sort((a, b) => a.platform.localeCompare(b.platform) || byManagedThenName(a, b)))
      setPages(accountRes.data.filter(a => a.platform === 'linkedin' && a.account_type === 'organization')
        .sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || a.account_name.localeCompare(b.account_name)))
      setMemberAccounts(accountRes.data.filter(a => a.platform === 'linkedin' && a.account_type === 'member'))
    }
    if (gscRes.data) {
      const get = k => gscRes.data.find(r => r.key === k)?.value || ''
      setGscSiteUrl(get('gsc_site_url'))
      setGscStatus({ lastSyncAt: get('gsc_last_sync_at'), status: get('gsc_last_sync_status') })
    }
    setLoading(false)
  }

  // ── LinkedIn ──
  const anyConnected = [...pages, ...memberAccounts].some(a => a.oauth_connected)
  const myProfile = memberAccounts.find(m => m.owner_profile_id === profile?.id)

  // Switches whether the BMS manages a Company Page (status active / disconnected).
  async function togglePage(page) {
    const turningOff = page.status === 'active'
    if (turningOff) {
      const { count } = await supabase.from('posts').select('id', { count: 'exact', head: true })
        .eq('account_id', page.id).in('status', ['scheduled', 'pending_approval'])
      const warning = count ? `\n\n${count} scheduled post(s) for this page will not publish automatically; at their time they move to Ready to Post.` : ''
      if (!window.confirm(`Stop managing ${page.account_name} from the BMS?${warning}`)) return
    }
    setTogglingId(page.id)
    const newStatus = turningOff ? 'disconnected' : 'active'
    const { error } = await supabase.from('connected_accounts').update({ status: newStatus }).eq('id', page.id)
    setTogglingId(null)
    if (error) { showToast('error', 'Failed to update page'); return }
    setPages(prev => prev.map(p => p.id === page.id ? { ...p, status: newStatus } : p))
    setMetaAccounts(prev => prev.map(p => p.id === page.id ? { ...p, status: newStatus } : p))
    showToast('success', turningOff ? `${page.account_name} is no longer managed` : `${page.account_name} is now managed — it appears under Post As`)
  }

  async function refreshPages() {
    setRefreshingPages(true)
    try {
      const { data, error } = await supabase.functions.invoke('sm-linkedin-pages', { body: {} })
      if (error) throw new Error('Could not reach the server. Please try again.')
      if (!data?.success) throw new Error(data?.error || 'Could not load your LinkedIn pages')
      const added = (data.pages || []).filter(p => p.is_new).length
      showToast('success', `${data.pages.length} page(s) found${added ? `, ${added} new` : ''}`)
      fetchData()
    } catch (err) {
      showToast('error', err.message)
    } finally {
      setRefreshingPages(false)
    }
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

  async function syncNow() {
    setSyncing(true)
    try {
      const { data, error } = await supabase.functions.invoke('sm-sync', { body: { force: true } })
      if (error) throw new Error('Could not reach sm-sync. Has it been deployed?')
      if (!data?.success) throw new Error(data?.error || 'Sync failed')
      const problems = Object.entries(data.accounts || {}).filter(([, r]) => r.error)
      if (problems.length) showToast('error', problems.map(([n, r]) => `${n}: ${r.error}`).join(' · '))
      else showToast('success', 'LinkedIn analytics and comments synced')
      fetchData()
    } catch (err) {
      showToast('error', err.message)
    } finally {
      setSyncing(false)
    }
  }

  async function setMemberStatus(member, newStatus) {
    const { error } = await supabase.from('connected_accounts').update({ status: newStatus }).eq('id', member.id)
    if (error) { showToast('error', 'Failed to update'); return }
    setMemberAccounts(prev => prev.map(m => m.id === member.id ? { ...m, status: newStatus } : m))
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
      <SettingsHeading title="Integrations" hint="The LinkedIn pages and profiles posts are published to, and the Google Search Console property behind Website Analytics." />

      <div className="section-card" style={{ padding: 'var(--space-lg)' }}>
        <div className="sm-account-row">
          <div>
            <div className="sm-account-platform">LinkedIn</div>
            <span className={`status-badge status-${anyConnected ? 'posted' : 'draft'}`}>{anyConnected ? 'Connected' : 'Not connected'}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {anyConnected && (
              <button className="btn btn-secondary btn-sm" onClick={syncNow} disabled={syncing}>{syncing ? 'Syncing...' : 'Sync now'}</button>
            )}
            {myProfile && (
              <button className="btn btn-secondary btn-sm" onClick={refreshPages} disabled={refreshingPages}>{refreshingPages ? 'Looking...' : 'Refresh pages'}</button>
            )}
            <button className="btn btn-primary btn-sm" onClick={connectLinkedIn} disabled={connectingLinkedIn}>
              {connectingLinkedIn ? 'Redirecting...' : anyConnected ? 'Reconnect LinkedIn' : 'Connect LinkedIn'}
            </button>
          </div>
        </div>
        <p className="form-hint">
          {anyConnected
            ? 'Scheduled posts publish automatically to the pages and profiles switched on below; analytics and new comments sync every hour.'
            : 'Assisted Mode: posts are published by hand. Connect LinkedIn to publish automatically to the Company Pages you administer and to your own profile.'}
        </p>

        <div className="sm-account-platform" style={{ margin: 'var(--space-md) 0 8px' }}>Company Pages</div>
        {pages.length === 0 ? (
          <p className="form-hint">No pages yet. Connect LinkedIn (or press Refresh pages) to list the pages you administer.</p>
        ) : pages.map(p => (
          <div key={p.id} className="sm-account-row" style={{ marginBottom: 8 }}>
            <div>
              <div>🏢 {p.account_name}</div>
              <span className={`status-badge status-${p.status === 'active' ? 'posted' : 'draft'}`}>{p.status === 'active' ? 'Managed in BMS' : 'Not managed'}</span>
              {p.status === 'active' && (
                <span className="status-badge" style={quietBadge}>{p.mode === 'automated' ? 'Publishes automatically' : 'Assisted Mode'}</span>
              )}
              {p.status === 'active' && p.last_sync_error && (
                <span className="status-badge status-failed" style={{ marginLeft: 6 }} title={p.last_sync_error}>Last sync failed</span>
              )}
              {p.status === 'active' && p.last_synced_at && !p.last_sync_error && (
                <span className="form-hint" style={{ marginLeft: 8 }}>Synced {new Date(p.last_synced_at).toLocaleString()}</span>
              )}
              <HistoryNote account={p} />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {p.status === 'active' && p.mode === 'automated' && (
                <button className="btn btn-secondary btn-sm" onClick={() => importHistory(p)} disabled={!!importingId}>
                  {importingId === p.id ? 'Importing…' : p.history_imported_at ? 'Re-import history' : 'Import history'}
                </button>
              )}
              <button
                className={`btn btn-sm ${p.status === 'active' ? 'btn-secondary' : 'btn-primary'}`}
                onClick={() => togglePage(p)}
                disabled={togglingId === p.id}
              >
                {p.status === 'active' ? 'Stop managing' : 'Manage in BMS'}
              </button>
            </div>
          </div>
        ))}
        <p className="form-hint">Managed pages appear under Post As in the composer. Pages you administer on LinkedIn but don't switch on here are never posted to.</p>

        <div className="sm-account-platform" style={{ margin: 'var(--space-md) 0 8px' }}>Personal Profiles</div>
        {memberAccounts.length === 0 ? (
          <p className="form-hint">None connected. Connecting LinkedIn also connects the profile of the person who signs in, so they can post as themselves.</p>
        ) : memberAccounts.map(m => (
          <div key={m.id} className="sm-account-row" style={{ marginBottom: 8 }}>
            <div>
              <div>👤 {m.account_name}{m.owner_profile_id === profile?.id ? ' (you)' : ''}</div>
              <span className={`status-badge status-${m.status === 'active' ? 'posted' : 'draft'}`}>{m.status === 'active' ? 'Active' : 'Disconnected'}</span>
              {m.last_sync_error && <span className="status-badge status-failed" style={{ marginLeft: 6 }} title={m.last_sync_error}>Last sync failed</span>}
              <HistoryNote account={m} />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {m.status === 'active' && m.owner_profile_id === profile?.id && (
                <button className="btn btn-secondary btn-sm" onClick={() => importHistory(m)} disabled={!!importingId}>
                  {importingId === m.id ? 'Importing…' : m.history_imported_at ? 'Re-import history' : 'Import history'}
                </button>
              )}
              <button className="btn btn-secondary btn-sm" onClick={() => setMemberStatus(m, m.status === 'active' ? 'disconnected' : 'active')}>
                {m.status === 'active' ? 'Disconnect' : 'Reactivate'}
              </button>
            </div>
          </div>
        ))}
        <p className="form-hint">Only the owner of a profile can schedule posts to it. Analytics sync for profile posts; comments on them do not, because LinkedIn does not offer that to this app.</p>
      </div>

      <div className="section-card" style={{ padding: 'var(--space-lg)', marginTop: 'var(--space-md)' }}>
        <div className="sm-account-row">
          <div>
            <div className="sm-account-platform"><PlatformIcon platform="facebook" size={18} /> <PlatformIcon platform="instagram" size={18} /> Meta — Facebook &amp; Instagram</div>
            <span className={`status-badge status-${metaAccounts.length ? 'posted' : 'draft'}`}>{metaAccounts.length ? 'Connected' : 'Not connected'}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {metaAccounts.length > 0 && <button className="btn btn-secondary btn-sm" onClick={syncNow} disabled={syncing}>{syncing ? 'Syncing...' : 'Sync now'}</button>}
            <button className="btn btn-primary btn-sm" onClick={connectMeta} disabled={connectingMeta}>
              {connectingMeta ? 'Redirecting...' : metaAccounts.length ? 'Reconnect Meta' : 'Connect Meta'}
            </button>
          </div>
        </div>
        <p className="form-hint">Sign in with the Facebook account that manages your Page. In Meta's window, select the Page <b>and</b> its Instagram account. Reconnect any time to add more.</p>
        {metaAccounts.map(a => (
          <div key={a.id} className="sm-account-row" style={{ marginBottom: 8 }}>
            <div>
              <div><PlatformIcon platform={a.platform} size={16} /> {a.account_name} <span className="form-hint">{a.platform === 'facebook' ? 'Facebook Page' : 'Instagram'}</span></div>
              <span className={`status-badge status-${a.status === 'active' ? 'posted' : 'draft'}`}>{a.status === 'active' ? 'Managed in BMS' : 'Not managed'}</span>
              {a.status === 'active' && a.last_sync_error && <span className="status-badge status-failed" style={{ marginLeft: 6 }} title={a.last_sync_error}>Last sync failed</span>}
              {a.status === 'active' && a.last_synced_at && !a.last_sync_error && <span className="form-hint" style={{ marginLeft: 8 }}>Synced {new Date(a.last_synced_at).toLocaleString()}</span>}
              <HistoryNote account={a} />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {a.status === 'active' && (
                <button className="btn btn-secondary btn-sm" onClick={() => importHistory(a)} disabled={!!importingId}>
                  {importingId === a.id ? 'Importing…' : a.history_imported_at ? 'Re-import history' : 'Import history'}
                </button>
              )}
              <button className={`btn btn-sm ${a.status === 'active' ? 'btn-secondary' : 'btn-primary'}`} onClick={() => togglePage(a)} disabled={togglingId === a.id}>
                {a.status === 'active' ? 'Stop managing' : 'Manage in BMS'}
              </button>
            </div>
          </div>
        ))}
        <p className="form-hint">Instagram posts need an image (JPEG) or a video; videos go out as Reels. Comments on both sync to the Inbox, where you can reply.</p>
      </div>

      <div className="section-card" style={{ padding: 'var(--space-lg)', marginTop: 'var(--space-md)' }}>
        <div className="sm-account-platform" style={{ marginBottom: 8 }}>More networks</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {PLATFORM_LIST.filter(p => p.status === 'coming_soon').map(p => (
            <span key={p.key} className="sm-chip" style={{ cursor: 'default' }}>
              <PlatformIcon platform={p} size={18} /> {p.name} <span className="status-badge" style={quietBadge}>Coming soon</span>
            </span>
          ))}
        </div>
        <p className="form-hint">The Planner, composer, Analytics, Inbox and Reports already handle these networks. Each one goes live when its connector is added (it needs that network's developer app and review).</p>
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

function HistoryNote({ account }) {
  if (!account.history_imported_at) return null
  return (
    <div className="form-hint" style={{ marginTop: 4 }}>
      History imported {new Date(account.history_imported_at).toLocaleDateString()}
      {account.history_import_note ? ` — ${account.history_import_note}` : ''}
    </div>
  )
}
