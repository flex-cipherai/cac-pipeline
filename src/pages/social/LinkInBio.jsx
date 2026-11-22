import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { fetchAllAccounts } from '../../lib/socialAccounts'
import { AccountAvatar, SocialHeader, EmptyState } from '../../components/social/SocialUI'
import BioView from '../../components/BioView/BioView'
import './LinkInBio.css'

const DEFAULT_THEME = { background: '#F3F2F2', button: '#EC3013', text: '#201E1D' }

function slugify(s) {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'links'
}

// Link in Bio (Metricool "SmartLinks"): a public page of links plus your
// latest posts, at <app>/l/<slug>. Views and clicks are counted by the
// bio-page Edge Function; links get UTM tags so Website Analytics sees them.
export default function LinkInBio() {
  const { profile } = useAuth()
  const [pages, setPages] = useState([])
  const [accounts, setAccounts] = useState([])
  const [page, setPage] = useState(null)       // page being edited
  const [links, setLinks] = useState([])
  const [removedLinks, setRemovedLinks] = useState([])
  const [previewPosts, setPreviewPosts] = useState([])
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)

  function showToast(type, text) { setToast({ type, text }); setTimeout(() => setToast(null), 4500) }

  useEffect(() => { loadPages() }, [])

  async function loadPages() {
    const [p, a] = await Promise.all([
      supabase.from('bio_pages').select('*, bio_links(clicks)').order('created_at'),
      fetchAllAccounts(),
    ])
    setPages(p.data || [])
    setAccounts(a)
  }

  async function open(p) {
    if (!p) {
      const org = accounts.find(a => a.account_type !== 'member')
      setPage({ slug: slugify(org?.account_name || 'sdfm'), title: org?.account_name || '', bio: '', avatar_url: '', theme: DEFAULT_THEME, account_ids: org ? [org.id] : [], show_latest_posts: true, published: false })
      setLinks([{ label: 'Visit our website', url: 'https://sdfmgroup.com', add_utm: true, active: true }])
    } else {
      setPage({ ...p, theme: { ...DEFAULT_THEME, ...(p.theme || {}) } })
      const { data } = await supabase.from('bio_links').select('*').eq('page_id', p.id).order('position')
      setLinks(data || [])
    }
    setRemovedLinks([])
  }

  useEffect(() => {
    if (!page?.show_latest_posts || !page.account_ids?.length) { setPreviewPosts([]); return }
    supabase.from('posts').select('caption, external_post_url').in('account_id', page.account_ids).eq('status', 'posted')
      .not('external_post_url', 'is', null).order('posted_at', { ascending: false }).limit(6)
      .then(({ data }) => setPreviewPosts((data || []).map(p => ({ url: p.external_post_url, caption: (p.caption || '').slice(0, 80), image: null }))))
  }, [page?.show_latest_posts, page?.account_ids?.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  const setLink = (i, patch) => setLinks(ls => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l))
  const move = (i, d) => setLinks(ls => { const n = [...ls]; const j = i + d; if (j < 0 || j >= n.length) return ls; [n[i], n[j]] = [n[j], n[i]]; return n })

  async function save(publishOverride) {
    if (!page.title.trim()) { showToast('error', 'Add a title'); return }
    if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(page.slug)) { showToast('error', 'The address can use lowercase letters, numbers and dashes (2–41 characters)'); return }
    const badLink = links.find(l => l.label.trim() && !/^https?:\/\/\S+\.\S+/.test(l.url.trim()))
    if (badLink) { showToast('error', `"${badLink.label}" needs a full link starting with https://`); return }
    setSaving(true)
    const payload = {
      slug: page.slug, title: page.title.trim(), bio: page.bio?.trim() || null, avatar_url: page.avatar_url?.trim() || null,
      theme: page.theme, account_ids: page.account_ids, show_latest_posts: page.show_latest_posts,
      published: publishOverride ?? page.published,
    }
    const res = page.id
      ? await supabase.from('bio_pages').update(payload).eq('id', page.id).select().single()
      : await supabase.from('bio_pages').insert({ ...payload, created_by: profile?.id }).select().single()
    if (res.error) {
      setSaving(false)
      showToast('error', /duplicate|unique/i.test(res.error.message) ? 'That address is taken — pick another' : res.error.message)
      return
    }
    const pageId = res.data.id
    if (removedLinks.length) await supabase.from('bio_links').delete().in('id', removedLinks)
    const rows = links.filter(l => l.label.trim() && l.url.trim()).map((l, i) => ({
      ...(l.id ? { id: l.id } : {}), page_id: pageId, label: l.label.trim(), url: l.url.trim(), position: i, active: l.active !== false, add_utm: l.add_utm !== false,
    }))
    const { error: linkError } = rows.length ? await supabase.from('bio_links').upsert(rows) : { error: null }
    setSaving(false)
    if (linkError) { showToast('error', linkError.message); return }
    setPage({ ...res.data, theme: { ...DEFAULT_THEME, ...(res.data.theme || {}) } })
    const { data: fresh } = await supabase.from('bio_links').select('*').eq('page_id', pageId).order('position')
    setLinks(fresh || [])
    setRemovedLinks([])
    showToast('success', payload.published ? 'Saved — the page is live' : 'Saved as a draft')
    loadPages()
  }

  async function remove(p) {
    if (!window.confirm(`Delete the page /l/${p.slug}? Its address stops working.`)) return
    await supabase.from('bio_pages').delete().eq('id', p.id)
    loadPages()
  }

  const publicUrl = slug => `${window.location.origin}/l/${slug}`

  if (!page) {
    return (
      <div className="lib-page">
        <SocialHeader title="Link in Bio" subtitle="One link for your profiles, with all your links and latest posts">
          <button className="btn btn-primary btn-sm" onClick={() => open(null)}>+ New page</button>
        </SocialHeader>
        {pages.length === 0 ? (
          <div className="section-card"><EmptyState title="No link pages yet" action={<button className="btn btn-primary btn-sm" onClick={() => open(null)}>Create your page</button>}>Put the link in your LinkedIn, Instagram or TikTok bio and point people to everything else.</EmptyState></div>
        ) : (
          <div className="lb-list">
            {pages.map(p => {
              const clicks = (p.bio_links || []).reduce((t, l) => t + (l.clicks || 0), 0)
              return (
                <div key={p.id} className="section-card lb-card">
                  <div>
                    <div className="lb-card-title">{p.title} <span className={`status-badge status-${p.published ? 'posted' : 'draft'}`}>{p.published ? 'Live' : 'Draft'}</span></div>
                    <a className="lb-card-url" href={publicUrl(p.slug)} target="_blank" rel="noopener noreferrer">{publicUrl(p.slug)}</a>
                    <div className="lb-card-stats">{p.views.toLocaleString()} views · {clicks.toLocaleString()} clicks · {p.views ? ((clicks / p.views) * 100).toFixed(1) : '0.0'}% click rate</div>
                  </div>
                  <div className="lb-card-actions">
                    <button className="btn btn-secondary btn-sm" onClick={() => { navigator.clipboard?.writeText(publicUrl(p.slug)); showToast('success', 'Link copied') }}>Copy link</button>
                    <button className="btn btn-primary btn-sm" onClick={() => open(p)}>Edit</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => remove(p)}>Delete</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {toast && <div className={`toast toast-${toast.type}`}>{toast.text}</div>}
      </div>
    )
  }

  return (
    <div className="lib-page">
      <SocialHeader title={page.id ? 'Edit link page' : 'New link page'} subtitle={page.published && page.id ? publicUrl(page.slug) : 'Not published yet'}>
        <button className="btn btn-secondary btn-sm" onClick={() => { setPage(null); loadPages() }}>Back</button>
        <button className="btn btn-secondary btn-sm" onClick={() => save()} disabled={saving}>Save</button>
        <button className="btn btn-primary btn-sm" onClick={() => save(!page.published)} disabled={saving}>{page.published ? 'Unpublish' : 'Publish'}</button>
      </SocialHeader>

      <div className="lb-layout">
        <div className="lb-form">
          <div className="section-card">
            <h2 className="section-card-title">Profile</h2>
            <div className="form-group">
              <label className="form-label">Address</label>
              <div className="lb-slug"><span>{window.location.origin}/l/</span><input className="form-input" value={page.slug} onChange={e => setPage(p => ({ ...p, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))} /></div>
            </div>
            <div className="form-group"><label className="form-label">Title</label><input className="form-input" value={page.title} onChange={e => setPage(p => ({ ...p, title: e.target.value }))} /></div>
            <div className="form-group"><label className="form-label">Short bio</label><textarea className="form-input" rows={2} value={page.bio || ''} onChange={e => setPage(p => ({ ...p, bio: e.target.value }))} /></div>
            <div className="form-group"><label className="form-label">Logo / photo URL (optional)</label><input className="form-input" value={page.avatar_url || ''} onChange={e => setPage(p => ({ ...p, avatar_url: e.target.value }))} placeholder="https://…/logo.png" /></div>
            <div className="lb-colors">
              {[['background', 'Background'], ['button', 'Buttons'], ['text', 'Text']].map(([k, l]) => (
                <label key={k} className="lb-color"><input type="color" value={page.theme[k]} onChange={e => setPage(p => ({ ...p, theme: { ...p.theme, [k]: e.target.value } }))} />{l}</label>
              ))}
            </div>
          </div>

          <div className="section-card">
            <div className="section-card-header">
              <h2 className="section-card-title">Links</h2>
              <button className="btn btn-secondary btn-sm" onClick={() => setLinks(ls => [...ls, { label: '', url: 'https://', add_utm: true, active: true }])}>+ Add link</button>
            </div>
            {links.map((l, i) => (
              <div key={l.id || `new-${i}`} className={`lb-link ${l.active === false ? 'off' : ''}`}>
                <div className="lb-link-fields">
                  <input className="form-input" value={l.label} onChange={e => setLink(i, { label: e.target.value })} placeholder="Button text" />
                  <input className="form-input" value={l.url} onChange={e => setLink(i, { url: e.target.value })} placeholder="https://…" />
                  <div className="lb-link-opts">
                    <label><input type="checkbox" checked={l.active !== false} onChange={e => setLink(i, { active: e.target.checked })} /> Show</label>
                    <label><input type="checkbox" checked={l.add_utm !== false} onChange={e => setLink(i, { add_utm: e.target.checked })} /> Add UTM tags</label>
                    {l.id && <span>{(l.clicks || 0).toLocaleString()} clicks</span>}
                  </div>
                </div>
                <div className="lb-link-actions">
                  <button className="btn btn-secondary btn-sm" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => move(i, 1)} disabled={i === links.length - 1}>↓</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => { if (l.id) setRemovedLinks(r => [...r, l.id]); setLinks(ls => ls.filter((_, idx) => idx !== i)) }}>✕</button>
                </div>
              </div>
            ))}
          </div>

          <div className="section-card">
            <h2 className="section-card-title">Latest posts</h2>
            <label className="cp-check"><input type="checkbox" checked={page.show_latest_posts} onChange={e => setPage(p => ({ ...p, show_latest_posts: e.target.checked }))} /> Show my latest published posts</label>
            {page.show_latest_posts && (
              <div className="lb-accounts">
                {accounts.map(a => {
                  const on = page.account_ids.includes(a.id)
                  return (
                    <button key={a.id} className={`sm-chip ${on ? 'active' : ''}`} onClick={() => setPage(p => ({ ...p, account_ids: on ? p.account_ids.filter(x => x !== a.id) : [...p.account_ids, a.id] }))}>
                      <AccountAvatar account={a} size={20} /><span className="sm-chip-label">{a.account_name}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        <div className="lb-phone-wrap">
          <div className="lb-phone">
            <BioView page={page} links={links.filter(l => l.active !== false && l.label.trim())} posts={previewPosts} preview />
          </div>
        </div>
      </div>
      {toast && <div className={`toast toast-${toast.type}`}>{toast.text}</div>}
    </div>
  )
}
