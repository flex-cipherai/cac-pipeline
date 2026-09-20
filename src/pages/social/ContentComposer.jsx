import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { buildUtmUrl, isValidUrl } from '../../lib/utm'
import LinkedInPostPreview from '../../components/LinkedInPostPreview/LinkedInPostPreview'
import './ContentLibrary.css'
import './ContentComposer.css'

const LINKEDIN_MAX_CHARS = 3000
const POST_TYPES = [
  { key: 'text', label: 'Text' },
  { key: 'image', label: 'Image' },
  { key: 'carousel', label: 'Document / Carousel' },
  { key: 'video', label: 'Video' },
  { key: 'poll', label: 'Poll' },
]

export default function ContentComposer() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()

  const [loading, setLoading] = useState(!!id)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState({ show: false, type: '', text: '' })

  const [account, setAccount] = useState(null)
  const [pillars, setPillars] = useState([])
  const [campaigns, setCampaigns] = useState([])
  const [hashtagSets, setHashtagSets] = useState([])
  const [templates, setTemplates] = useState([])
  const [approvalEnabled, setApprovalEnabled] = useState(false)

  const [postType, setPostType] = useState('text')
  const [caption, setCaption] = useState('')
  const [hashtagInput, setHashtagInput] = useState('')
  const [mentionInput, setMentionInput] = useState('')
  const [pillarId, setPillarId] = useState('')
  const [campaignId, setCampaignId] = useState('')
  const [pollOptions, setPollOptions] = useState(['', ''])
  const [selectedAssets, setSelectedAssets] = useState([]) // [{id, file_name, previewUrl}]
  const [scheduledDate, setScheduledDate] = useState('')
  const [scheduledTime, setScheduledTime] = useState('')
  const [status, setStatus] = useState('draft')
  const [postId, setPostId] = useState(id || null)

  const [rawLink, setRawLink] = useState('')
  const [device, setDevice] = useState('desktop')

  const [showAssetPicker, setShowAssetPicker] = useState(false)
  const [libraryAssets, setLibraryAssets] = useState([])
  const [libSignedUrls, setLibSignedUrls] = useState({})

  const [showNewPillar, setShowNewPillar] = useState(false)
  const [newPillarName, setNewPillarName] = useState('')
  const [showNewCampaign, setShowNewCampaign] = useState(false)
  const [newCampaignName, setNewCampaignName] = useState('')

  const hashtags = useMemo(() => hashtagInput.split(/[\s,]+/).map(h => h.replace(/^#/, '').trim()).filter(Boolean), [hashtagInput])
  const mentions = useMemo(() => mentionInput.split(/[,]+/).map(m => m.trim()).filter(Boolean), [mentionInput])

  useEffect(() => { fetchLookups() }, [])
  useEffect(() => { if (id) fetchPost(id) }, [id])

  useEffect(() => {
    if (toast.show) {
      const t = setTimeout(() => setToast({ show: false, type: '', text: '' }), 4000)
      return () => clearTimeout(t)
    }
  }, [toast.show])

  function showToast(type, text) { setToast({ show: true, type, text }) }

  async function fetchLookups() {
    const [accountRes, pillarsRes, campaignsRes, hashtagSetsRes, templatesRes, approvalRes] = await Promise.all([
      supabase.from('connected_accounts').select('*').eq('platform', 'linkedin').maybeSingle(),
      supabase.from('content_pillars').select('*').order('name'),
      supabase.from('content_campaigns').select('*').order('name'),
      supabase.from('hashtag_sets').select('*').order('name'),
      supabase.from('posts').select('id, template_name, post_type, caption, hashtags, pillar_id, campaign_id').eq('is_template', true).order('template_name'),
      supabase.from('system_settings').select('value').eq('key', 'sm_approval_workflow_enabled').maybeSingle(),
    ])
    if (accountRes.data) setAccount(accountRes.data)
    if (pillarsRes.data) setPillars(pillarsRes.data)
    if (campaignsRes.data) setCampaigns(campaignsRes.data)
    if (hashtagSetsRes.data) setHashtagSets(hashtagSetsRes.data)
    if (templatesRes.data) setTemplates(templatesRes.data)
    setApprovalEnabled(approvalRes.data?.value === 'true')
  }

  async function fetchPost(postId) {
    setLoading(true)
    const { data: post } = await supabase.from('posts').select('*').eq('id', postId).single()
    if (post) {
      setPostType(post.post_type)
      setCaption(post.caption || '')
      setHashtagInput((post.hashtags || []).join(' '))
      setMentionInput((post.mentions || []).join(', '))
      setPillarId(post.pillar_id || '')
      setCampaignId(post.campaign_id || '')
      setStatus(post.status)
      setRawLink(post.utm_url || '')
      if (post.poll_options) setPollOptions(post.poll_options.map(o => o.text || o))
      if (post.scheduled_at) {
        const d = new Date(post.scheduled_at)
        setScheduledDate(d.toISOString().slice(0, 10))
        setScheduledTime(d.toTimeString().slice(0, 5))
      }
      const { data: postAssets } = await supabase
        .from('post_assets').select('position, content_assets(id, file_name, file_path, file_type)')
        .eq('post_id', postId).order('position')
      if (postAssets && postAssets.length > 0) {
        const paths = postAssets.filter(pa => pa.content_assets?.file_type === 'image').map(pa => pa.content_assets.file_path)
        let urlMap = {}
        if (paths.length > 0) {
          const { data: signed } = await supabase.storage.from('content-library').createSignedUrls(paths, 3600)
          signed?.forEach(s => { if (s.path && s.signedUrl) urlMap[s.path] = s.signedUrl })
        }
        setSelectedAssets(postAssets.map(pa => ({
          id: pa.content_assets.id,
          file_name: pa.content_assets.file_name,
          file_type: pa.content_assets.file_type,
          previewUrl: urlMap[pa.content_assets.file_path],
        })))
      }
    }
    setLoading(false)
  }

  async function openAssetPicker() {
    const { data } = await supabase.from('content_assets').select('*').order('created_at', { ascending: false })
    if (data) {
      setLibraryAssets(data)
      const imagePaths = data.filter(a => a.file_type === 'image').map(a => a.file_path)
      if (imagePaths.length > 0) {
        const { data: signed } = await supabase.storage.from('content-library').createSignedUrls(imagePaths, 3600)
        const map = {}
        signed?.forEach(s => { if (s.path && s.signedUrl) map[s.path] = s.signedUrl })
        setLibSignedUrls(map)
      }
    }
    setShowAssetPicker(true)
  }

  function toggleAssetSelection(asset) {
    setSelectedAssets(prev => {
      const exists = prev.find(a => a.id === asset.id)
      if (exists) return prev.filter(a => a.id !== asset.id)
      if (postType === 'image' && prev.length >= 9) return prev
      if ((postType === 'video' || postType === 'carousel') && prev.length >= 1) return [{ id: asset.id, file_name: asset.file_name, file_type: asset.file_type, previewUrl: libSignedUrls[asset.file_path] }]
      return [...prev, { id: asset.id, file_name: asset.file_name, file_type: asset.file_type, previewUrl: libSignedUrls[asset.file_path] }]
    })
  }

  async function createPillar() {
    if (!newPillarName.trim()) return
    const { data, error } = await supabase.from('content_pillars').insert({ name: newPillarName.trim() }).select().single()
    if (error) { showToast('error', 'Failed to create pillar'); return }
    setPillars(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
    setPillarId(data.id)
    setNewPillarName('')
    setShowNewPillar(false)
  }

  async function createCampaign() {
    if (!newCampaignName.trim()) return
    const { data, error } = await supabase.from('content_campaigns').insert({ name: newCampaignName.trim() }).select().single()
    if (error) { showToast('error', 'Failed to create campaign'); return }
    setCampaigns(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
    setCampaignId(data.id)
    setNewCampaignName('')
    setShowNewCampaign(false)
  }

  function loadTemplate(templateId) {
    const tmpl = templates.find(t => t.id === templateId)
    if (!tmpl) return
    setPostType(tmpl.post_type)
    setCaption(tmpl.caption || '')
    setHashtagInput((tmpl.hashtags || []).join(' '))
    setPillarId(tmpl.pillar_id || '')
    setCampaignId(tmpl.campaign_id || '')
    showToast('success', 'Template loaded')
  }

  function applyHashtagSet(setId) {
    const set = hashtagSets.find(s => s.id === setId)
    if (!set) return
    const merged = new Set([...hashtags, ...set.hashtags])
    setHashtagInput(Array.from(merged).join(' '))
  }

  const campaignName = campaigns.find(c => c.id === campaignId)?.name
  const utmUrl = rawLink ? buildUtmUrl(rawLink, { campaign: campaignName }) : ''

  function buildPostPayload(overrides = {}) {
    const scheduledAt = scheduledDate && scheduledTime ? new Date(`${scheduledDate}T${scheduledTime}`).toISOString() : null
    return {
      account_id: account?.id || null,
      post_type: postType,
      caption,
      hashtags,
      mentions,
      pillar_id: pillarId || null,
      campaign_id: campaignId || null,
      utm_url: utmUrl || null,
      mode: account?.mode || 'assisted',
      poll_options: postType === 'poll' ? pollOptions.filter(Boolean).map(text => ({ text })) : null,
      scheduled_at: scheduledAt,
      created_by: profile?.id,
      ...overrides,
    }
  }

  async function persistPostAssets(savedPostId) {
    await supabase.from('post_assets').delete().eq('post_id', savedPostId)
    if (selectedAssets.length > 0) {
      await supabase.from('post_assets').insert(
        selectedAssets.map((a, i) => ({ post_id: savedPostId, asset_id: a.id, position: i }))
      )
    }
  }

  async function savePost(overrides, successMessage) {
    if (!caption.trim() && postType === 'text') {
      showToast('error', 'Write a caption before saving')
      return null
    }
    setSaving(true)
    const payload = buildPostPayload(overrides)
    let result
    if (postId) {
      result = await supabase.from('posts').update(payload).eq('id', postId).select().single()
    } else {
      result = await supabase.from('posts').insert(payload).select().single()
    }
    setSaving(false)
    if (result.error) {
      showToast('error', result.error.message || 'Failed to save post')
      return null
    }
    setPostId(result.data.id)
    setStatus(result.data.status)
    await persistPostAssets(result.data.id)
    if (successMessage) showToast('success', successMessage)
    return result.data
  }

  async function handleSaveDraft() {
    await savePost({ status: 'draft' }, 'Draft saved')
  }

  async function handleSchedule() {
    if (!scheduledDate || !scheduledTime) {
      showToast('error', 'Pick a date and time to schedule')
      return
    }
    await savePost({ status: 'scheduled' }, 'Post scheduled')
    navigate('/social/calendar')
  }

  async function handleSubmitForApproval() {
    const saved = await savePost({ status: 'pending_approval' })
    if (!saved) return
    await supabase.from('post_approval_history').insert({ post_id: saved.id, action: 'submitted', actor_id: profile?.id })
    await supabase.functions.invoke('sm-notify-event', {
      body: { event: 'approval_requested', post_id: saved.id, actor_id: profile?.id },
    }).catch(() => {})
    showToast('success', 'Submitted for approval')
    navigate('/social/approvals')
  }

  async function handleSaveAsTemplate() {
    const name = window.prompt('Template name?')
    if (!name) return
    const payload = buildPostPayload({ status: 'draft', is_template: true, template_name: name, scheduled_at: null })
    const { error } = await supabase.from('posts').insert(payload)
    if (error) { showToast('error', 'Failed to save template'); return }
    showToast('success', 'Saved as template')
    fetchLookups()
  }

  const charCount = caption.length
  const overLimit = charCount > LINKEDIN_MAX_CHARS

  if (loading) {
    return (
      <div>
        <div className="page-header"><h1 className="page-title">Composer</h1></div>
        <div className="skeleton skeleton-card" style={{ height: 400 }} />
      </div>
    )
  }

  return (
    <div className="composer-page">
      <div className="page-header">
        <h1 className="page-title">{postId ? 'Edit Post' : 'New Post'}</h1>
        <p className="page-subtitle">
          {account?.account_name || 'LinkedIn Company Page'} · <span className={`status-badge status-${status}`}>{status.replace(/_/g, ' ')}</span>
        </p>
      </div>

      <div className="composer-layout">
        {/* ── Form ── */}
        <div className="composer-form">
          <div className="section-card">
            <div className="section-card-header">
              <h2 className="section-card-title">Post Type</h2>
              {templates.length > 0 && (
                <select className="form-input composer-template-select" defaultValue="" onChange={e => e.target.value && loadTemplate(e.target.value)}>
                  <option value="">Load a template…</option>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.template_name}</option>)}
                </select>
              )}
            </div>
            <div className="composer-type-pills">
              {POST_TYPES.map(t => (
                <button key={t.key} className={`lib-type-pill ${postType === t.key ? 'active' : ''}`} onClick={() => setPostType(t.key)}>{t.label}</button>
              ))}
            </div>
          </div>

          <div className="section-card">
            <h2 className="section-card-title">Caption</h2>
            <textarea
              className="form-input composer-textarea"
              rows={8}
              value={caption}
              onChange={e => setCaption(e.target.value)}
              placeholder="Write your LinkedIn post…"
            />
            <div className={`composer-char-count ${overLimit ? 'over' : ''}`}>{charCount} / {LINKEDIN_MAX_CHARS}</div>
          </div>

          {postType === 'poll' && (
            <div className="section-card">
              <h2 className="section-card-title">Poll Options</h2>
              {pollOptions.map((opt, i) => (
                <div className="form-group" key={i}>
                  <input
                    className="form-input"
                    value={opt}
                    placeholder={`Option ${i + 1}`}
                    onChange={e => setPollOptions(prev => prev.map((o, idx) => idx === i ? e.target.value : o))}
                  />
                </div>
              ))}
              {pollOptions.length < 4 && (
                <button className="btn btn-secondary btn-sm" onClick={() => setPollOptions(prev => [...prev, ''])}>+ Add Option</button>
              )}
            </div>
          )}

          {(postType === 'image' || postType === 'video' || postType === 'carousel') && (
            <div className="section-card">
              <div className="section-card-header">
                <h2 className="section-card-title">Media</h2>
                <button className="btn btn-secondary btn-sm" onClick={openAssetPicker}>Choose from Library</button>
              </div>
              {selectedAssets.length === 0 ? (
                <p className="composer-hint">No media selected yet.</p>
              ) : (
                <div className="composer-selected-media">
                  {selectedAssets.map(a => (
                    <div key={a.id} className="composer-selected-item">
                      {a.previewUrl ? <img src={a.previewUrl} alt="" /> : <span className="lib-card-icon">{a.file_type === 'video' ? '🎬' : '📄'}</span>}
                      <button className="composer-remove-media" onClick={() => setSelectedAssets(prev => prev.filter(x => x.id !== a.id))}>&times;</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="section-card">
            <h2 className="section-card-title">Hashtags &amp; Mentions</h2>
            <div className="form-group">
              <label className="form-label">Hashtags (space or comma separated)</label>
              <input className="form-input" value={hashtagInput} onChange={e => setHashtagInput(e.target.value)} placeholder="#AI #KenyaBusiness" />
              {hashtagSets.length > 0 && (
                <select className="form-input" style={{ marginTop: 6 }} defaultValue="" onChange={e => e.target.value && applyHashtagSet(e.target.value)}>
                  <option value="">Insert a saved hashtag set…</option>
                  {hashtagSets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
            </div>
            <div className="form-group">
              <label className="form-label">Mentions (comma separated)</label>
              <input className="form-input" value={mentionInput} onChange={e => setMentionInput(e.target.value)} placeholder="@Person, @Page" />
            </div>
          </div>

          <div className="section-card">
            <h2 className="section-card-title">Link &amp; UTM Tracking</h2>
            <div className="form-group">
              <label className="form-label">Link to include in the post</label>
              <input className="form-input" value={rawLink} onChange={e => setRawLink(e.target.value)} placeholder="https://sdfmgroup.com/..." />
              {rawLink && !isValidUrl(rawLink) && <span className="form-error">Enter a full URL, e.g. https://…</span>}
            </div>
            {utmUrl && isValidUrl(rawLink) && (
              <div className="composer-utm-output">
                <span>{utmUrl}</span>
                <button className="btn btn-secondary btn-sm" onClick={() => { navigator.clipboard?.writeText(utmUrl); showToast('success', 'Copied') }}>Copy</button>
              </div>
            )}
          </div>

          <div className="section-card">
            <h2 className="section-card-title">Pillar &amp; Campaign</h2>
            <div className="composer-two-col">
              <div className="form-group">
                <label className="form-label">Content Pillar</label>
                <select className="form-input" value={pillarId} onChange={e => e.target.value === '__new__' ? setShowNewPillar(true) : setPillarId(e.target.value)}>
                  <option value="">None</option>
                  {pillars.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  <option value="__new__">+ New pillar…</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Campaign</label>
                <select className="form-input" value={campaignId} onChange={e => e.target.value === '__new__' ? setShowNewCampaign(true) : setCampaignId(e.target.value)}>
                  <option value="">None</option>
                  {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  <option value="__new__">+ New campaign…</option>
                </select>
              </div>
            </div>
          </div>

          <div className="section-card">
            <h2 className="section-card-title">Schedule</h2>
            <div className="composer-two-col">
              <div className="form-group">
                <label className="form-label">Date</label>
                <input type="date" className="form-input" value={scheduledDate} onChange={e => setScheduledDate(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Time</label>
                <input type="time" className="form-input" value={scheduledTime} onChange={e => setScheduledTime(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="composer-actions">
            <button className="btn btn-secondary" onClick={handleSaveAsTemplate} disabled={saving}>Save as Template</button>
            <button className="btn btn-secondary" onClick={handleSaveDraft} disabled={saving}>Save Draft</button>
            {approvalEnabled ? (
              <button className="btn btn-primary" onClick={handleSubmitForApproval} disabled={saving || overLimit}>Submit for Approval</button>
            ) : (
              <button className="btn btn-primary" onClick={handleSchedule} disabled={saving || overLimit}>Schedule Post</button>
            )}
          </div>
        </div>

        {/* ── Live Preview ── */}
        <div className="composer-preview">
          <div className="composer-preview-toggle">
            <button className={`lib-type-pill ${device === 'desktop' ? 'active' : ''}`} onClick={() => setDevice('desktop')}>Desktop</button>
            <button className={`lib-type-pill ${device === 'mobile' ? 'active' : ''}`} onClick={() => setDevice('mobile')}>Mobile</button>
          </div>
          <LinkedInPostPreview
            accountName={account?.account_name}
            caption={caption}
            hashtags={hashtags}
            postType={postType}
            assets={selectedAssets}
            device={device}
          />
        </div>
      </div>

      {/* Asset picker modal */}
      {showAssetPicker && (
        <div className="modal-overlay" onClick={() => setShowAssetPicker(false)}>
          <div className="modal-card modal-card-wide" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Choose from Library</h3>
            <div className="lib-grid composer-picker-grid">
              {libraryAssets.map(a => {
                const isSelected = selectedAssets.some(s => s.id === a.id)
                return (
                  <button key={a.id} className={`lib-card ${isSelected ? 'selected' : ''}`} onClick={() => toggleAssetSelection(a)}>
                    <div className="lib-card-thumb">
                      {a.file_type === 'image' && libSignedUrls[a.file_path] ? <img src={libSignedUrls[a.file_path]} alt="" /> : <span className="lib-card-icon">{a.file_type === 'video' ? '🎬' : '📄'}</span>}
                    </div>
                    <div className="lib-card-name">{a.file_name}</div>
                  </button>
                )
              })}
            </div>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={() => setShowAssetPicker(false)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {showNewPillar && (
        <div className="modal-overlay" onClick={() => setShowNewPillar(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">New Content Pillar</h3>
            <div className="form-group">
              <input className="form-input" value={newPillarName} onChange={e => setNewPillarName(e.target.value)} placeholder="e.g. Case Studies" autoFocus />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowNewPillar(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={createPillar}>Create</button>
            </div>
          </div>
        </div>
      )}

      {showNewCampaign && (
        <div className="modal-overlay" onClick={() => setShowNewCampaign(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">New Campaign</h3>
            <div className="form-group">
              <input className="form-input" value={newCampaignName} onChange={e => setNewCampaignName(e.target.value)} placeholder="e.g. The Foundation" autoFocus />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowNewCampaign(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={createCampaign}>Create</button>
            </div>
          </div>
        </div>
      )}

      {toast.show && <div className={`toast toast-${toast.type}`}>{toast.text}</div>}
    </div>
  )
}
