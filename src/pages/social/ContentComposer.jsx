import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { DateTime } from 'luxon'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { buildUtmUrl, isValidUrl } from '../../lib/utm'
import { fetchPostableAccounts, defaultAccountId } from '../../lib/socialAccounts'
import { platformOf, validateForAccount, capabilitiesOf, POST_TYPE_LABELS, accountKindLabel } from '../../lib/platforms'
import { nextQueueSlot } from '../../lib/bestTimes'
import { AccountAvatar, PlatformIcon } from '../../components/social/SocialUI'
import PostPreview from '../../components/PostPreview/PostPreview'
import './ContentLibrary.css'
import './ContentComposer.css'

const LOCKED = ['posted', 'publishing']
const STATUS_TEXT = { draft: 'Draft', pending_approval: 'Pending approval', changes_requested: 'Changes requested', scheduled: 'Scheduled', publishing: 'Publishing', ready_to_post: 'Ready to post', posted: 'Published', failed: 'Failed' }

// Metricool-style composer: write once, publish to several accounts (one
// posts row per account, sharing post_group_id), with per-account caption
// overrides, per-network previews and checks, a first comment, and
// schedule / add to queue / publish now / repeat / add to autolist.
export default function ContentComposer() {
  const { id } = useParams()
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)

  // Lookups
  const [accounts, setAccounts] = useState([])
  const [pillars, setPillars] = useState([])
  const [campaigns, setCampaigns] = useState([])
  const [hashtagSets, setHashtagSets] = useState([])
  const [templates, setTemplates] = useState([])
  const [autolists, setAutolists] = useState([])
  const [approvalEnabled, setApprovalEnabled] = useState(false)

  // The post (group)
  const [rows, setRows] = useState([])            // existing sibling rows (one per account)
  const [templateRow, setTemplateRow] = useState(null) // editing a template / autolist item
  const [selectedIds, setSelectedIds] = useState([])
  const [postType, setPostType] = useState('text')
  const [caption, setCaption] = useState('')
  const [overrides, setOverrides] = useState({})  // accountId → caption
  const [hashtagInput, setHashtagInput] = useState('')
  const [firstComment, setFirstComment] = useState('')
  const [pillarId, setPillarId] = useState('')
  const [campaignId, setCampaignId] = useState('')
  const [pollQuestion, setPollQuestion] = useState('')
  const [pollOptions, setPollOptions] = useState(['', ''])
  const [pollDuration, setPollDuration] = useState('THREE_DAYS')
  const [selectedAssets, setSelectedAssets] = useState([])
  const [rawLink, setRawLink] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [repeat, setRepeat] = useState(null)      // { freq, interval, until }

  // UI
  const [captionTab, setCaptionTab] = useState('all')
  const [previewId, setPreviewId] = useState('')
  const [device, setDevice] = useState('desktop')
  const [showAssetPicker, setShowAssetPicker] = useState(false)
  const [libraryAssets, setLibraryAssets] = useState([])
  const [libSignedUrls, setLibSignedUrls] = useState({})
  const [showAutolistPick, setShowAutolistPick] = useState(false)
  const [newName, setNewName] = useState({ kind: '', value: '' })

  const hashtags = useMemo(() => hashtagInput.split(/[\s,]+/).map(h => h.replace(/^#/, '').trim()).filter(Boolean), [hashtagInput])
  const selectedAccounts = accounts.filter(a => selectedIds.includes(a.id))
  const locked = rows.some(r => LOCKED.includes(r.status))
  const groupStatus = rows.length ? (rows.find(r => r.status === 'failed')?.status || rows[0].status) : 'draft'
  const mustRequestApproval = approvalEnabled && !isAdmin
  const campaignName = campaigns.find(c => c.id === campaignId)?.name
  const utmUrl = rawLink && isValidUrl(rawLink) ? buildUtmUrl(rawLink, { campaign: campaignName }) : ''

  function showToast(type, text) {
    setToast({ type, text })
    setTimeout(() => setToast(null), 4500)
  }

  useEffect(() => { if (profile?.id) init() }, [profile?.id, id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function init() {
    setLoading(true)
    const [accs, pillarsRes, campaignsRes, setsRes, templatesRes, autolistsRes, approvalRes] = await Promise.all([
      fetchPostableAccounts(profile.id),
      supabase.from('content_pillars').select('*').order('name'),
      supabase.from('content_campaigns').select('*').order('name'),
      supabase.from('hashtag_sets').select('*').order('name'),
      supabase.from('posts').select('id, template_name, post_type, caption, hashtags, pillar_id, campaign_id, first_comment').eq('is_template', true).is('autolist_id', null).order('template_name'),
      supabase.from('autolists').select('id, name, active').order('name'),
      supabase.from('system_settings').select('value').eq('key', 'sm_approval_workflow_enabled').maybeSingle(),
    ])
    setPillars(pillarsRes.data || [])
    setCampaigns(campaignsRes.data || [])
    setHashtagSets(setsRes.data || [])
    setTemplates(templatesRes.data || [])
    setAutolists(autolistsRes.data || [])
    setApprovalEnabled(approvalRes.data?.value === 'true')

    if (id) {
      setAccounts(await loadPost(id, accs))
    } else {
      setAccounts(accs)
      const pre = search.get('account')
      const start = pre && accs.some(a => a.id === pre) ? [pre] : [defaultAccountId(accs)].filter(Boolean)
      setSelectedIds(start)
      setPreviewId(start[0] || '')
      const at = search.get('at') ? DateTime.fromISO(search.get('at')) : null
      if (at?.isValid) { setDate(at.toISODate()); setTime(at.toFormat('HH:mm')) }
    }
    setLoading(false)
  }

  // Loads a post and its group siblings. Accounts used by the group but no
  // longer postable by this person stay visible (read-only) so nothing is lost.
  async function loadPost(postId, accs) {
    const { data: post } = await supabase.from('posts').select('*').eq('id', postId).single()
    if (!post) { showToast('error', 'Post not found'); return accs }

    let siblings = [post]
    if (post.is_template) {
      setTemplateRow(post)
    } else {
      const { data } = await supabase.from('posts').select('*').eq('post_group_id', post.post_group_id).eq('is_template', false)
      siblings = data?.length ? data : [post]
      setRows(siblings)
    }

    const lead = siblings.find(s => s.id === post.id) || post
    setPostType(lead.post_type)
    setCaption(lead.caption || '')
    const ov = {}
    siblings.forEach(s => { if ((s.caption || '') !== (lead.caption || '')) ov[s.account_id] = s.caption || '' })
    setOverrides(ov)
    setHashtagInput((lead.hashtags || []).join(' '))
    setFirstComment(lead.first_comment || '')
    setPillarId(lead.pillar_id || '')
    setCampaignId(lead.campaign_id || '')
    setRawLink(lead.utm_url || '')
    setPollQuestion(lead.poll_question || '')
    if (lead.poll_options) setPollOptions(lead.poll_options.map(o => o.text || o))
    setPollDuration(lead.poll_duration || 'THREE_DAYS')
    setRepeat(lead.recurrence || null)
    if (lead.scheduled_at) {
      const d = DateTime.fromISO(lead.scheduled_at)
      setDate(d.toISODate()); setTime(d.toFormat('HH:mm'))
    }
    const ids = [...new Set(siblings.map(s => s.account_id).filter(Boolean))]
    setSelectedIds(ids)
    setPreviewId(ids[0] || '')

    const { data: postAssets } = await supabase.from('post_assets')
      .select('position, content_assets(id, file_name, file_path, file_type)').eq('post_id', post.id).order('position')
    if (postAssets?.length) {
      const paths = postAssets.filter(pa => pa.content_assets?.file_type === 'image').map(pa => pa.content_assets.file_path)
      const urlMap = {}
      if (paths.length) {
        const { data: signed } = await supabase.storage.from('content-library').createSignedUrls(paths, 3600)
        signed?.forEach(s => { if (s.path && s.signedUrl) urlMap[s.path] = s.signedUrl })
      }
      setSelectedAssets(postAssets.filter(pa => pa.content_assets).map(pa => ({ ...pa.content_assets, previewUrl: urlMap[pa.content_assets.file_path] })))
    }

    const missing = ids.filter(aid => !accs.some(a => a.id === aid))
    if (!missing.length) return accs
    const { data: extra } = await supabase.from('connected_accounts').select('*').in('id', missing)
    return [...accs, ...(extra || []).map(a => ({ ...a, readOnly: true }))]
  }

  // ── Accounts & captions ──
  function toggleAccount(aid) {
    if (locked) return
    setSelectedIds(prev => {
      const next = prev.includes(aid) ? prev.filter(x => x !== aid) : [...prev, aid]
      if (!next.includes(previewId)) setPreviewId(next[0] || '')
      if (captionTab !== 'all' && !next.includes(captionTab)) setCaptionTab('all')
      return next
    })
  }

  const captionFor = aid => overrides[aid] ?? caption
  const editingOverride = captionTab !== 'all' && overrides[captionTab] !== undefined
  const tabAccount = accounts.find(a => a.id === captionTab)
  const activeText = captionTab === 'all' ? caption : captionFor(captionTab)
  const activeLimit = captionTab === 'all'
    ? Math.min(...(selectedAccounts.length ? selectedAccounts : [{ platform: 'linkedin' }]).map(a => platformOf(a).limits.caption))
    : platformOf(tabAccount).limits.caption
  const textLength = [activeText.trim(), hashtags.map(h => `#${h}`).join(' ')].filter(Boolean).join('\n\n').length

  function setActiveText(v) {
    if (captionTab === 'all' || !editingOverride) setCaption(v)
    else setOverrides(o => ({ ...o, [captionTab]: v }))
  }

  // ── Validation (per account, against its platform) ──
  const problems = useMemo(() => selectedAccounts.map(a => ({
    account: a,
    list: validateForAccount(a, { caption: captionFor(a.id), hashtags, postType, assets: selectedAssets, pollQuestion, pollOptions, firstComment }),
  })).filter(p => p.list.length), [selectedAccounts, caption, overrides, hashtags, postType, selectedAssets, pollQuestion, pollOptions, firstComment]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Media library ──
  async function openAssetPicker() {
    const { data } = await supabase.from('content_assets').select('*').order('created_at', { ascending: false })
    setLibraryAssets(data || [])
    const imagePaths = (data || []).filter(a => a.file_type === 'image').map(a => a.file_path)
    if (imagePaths.length) {
      const { data: signed } = await supabase.storage.from('content-library').createSignedUrls(imagePaths, 3600)
      const map = {}
      signed?.forEach(s => { if (s.path && s.signedUrl) map[s.path] = s.signedUrl })
      setLibSignedUrls(map)
    }
    setShowAssetPicker(true)
  }

  function toggleAsset(asset) {
    const item = { id: asset.id, file_name: asset.file_name, file_type: asset.file_type, file_path: asset.file_path, previewUrl: libSignedUrls[asset.file_path] }
    setSelectedAssets(prev => {
      if (prev.some(a => a.id === asset.id)) return prev.filter(a => a.id !== asset.id)
      if (postType === 'video' || postType === 'carousel') return [item]
      if (prev.length >= 20) return prev
      return [...prev, item]
    })
  }

  // ── Templates, pillars, campaigns, hashtag sets ──
  function loadTemplate(tid) {
    const t = templates.find(x => x.id === tid)
    if (!t) return
    setPostType(t.post_type); setCaption(t.caption || ''); setHashtagInput((t.hashtags || []).join(' '))
    setPillarId(t.pillar_id || ''); setCampaignId(t.campaign_id || ''); setFirstComment(t.first_comment || '')
    showToast('success', 'Template loaded')
  }

  function applyHashtagSet(sid) {
    const s = hashtagSets.find(x => x.id === sid)
    if (s) setHashtagInput([...new Set([...hashtags, ...s.hashtags])].join(' '))
  }

  async function createNamed() {
    const value = newName.value.trim()
    if (!value) return
    const table = newName.kind === 'pillar' ? 'content_pillars' : 'content_campaigns'
    const { data, error } = await supabase.from(table).insert({ name: value }).select().single()
    if (error) { showToast('error', `Failed to create ${newName.kind}`); return }
    if (newName.kind === 'pillar') { setPillars(p => [...p, data].sort((a, b) => a.name.localeCompare(b.name))); setPillarId(data.id) }
    else { setCampaigns(c => [...c, data].sort((a, b) => a.name.localeCompare(b.name))); setCampaignId(data.id) }
    setNewName({ kind: '', value: '' })
  }

  // ── Saving ──
  function baseFields(account) {
    return {
      account_id: account.id,
      post_type: postType,
      caption: captionFor(account.id),
      hashtags,
      mentions: [],
      pillar_id: pillarId || null,
      campaign_id: campaignId || null,
      utm_url: utmUrl || null,
      mode: account.mode || 'assisted',
      poll_options: postType === 'poll' ? pollOptions.filter(Boolean).map(text => ({ text })) : null,
      poll_question: postType === 'poll' ? pollQuestion.trim() || null : null,
      poll_duration: pollDuration,
      first_comment: firstComment.trim() || null,
      recurrence: repeat?.freq ? { ...repeat, until: repeat.until || null } : null,
    }
  }

  async function persistAssets(postId) {
    await supabase.from('post_assets').delete().eq('post_id', postId)
    if (selectedAssets.length) {
      await supabase.from('post_assets').insert(selectedAssets.map((a, i) => ({ post_id: postId, asset_id: a.id, position: i })))
    }
  }

  // Writes one row per selected account (sharing a group) and removes rows
  // for accounts that were deselected. `timeFor(account)` → ISO or null.
  async function saveGroup(status, timeFor) {
    if (!selectedAccounts.length) { showToast('error', 'Pick at least one account'); return null }
    setSaving(true)
    const groupId = rows[0]?.post_group_id || crypto.randomUUID()
    const saved = []
    try {
      for (const account of selectedAccounts) {
        const existing = rows.find(r => r.account_id === account.id)
        const payload = {
          ...baseFields(account),
          status,
          scheduled_at: timeFor(account),
          post_group_id: groupId,
          ...(['scheduled', 'pending_approval'].includes(status) ? { publish_error: null, publish_state: null } : {}),
        }
        const res = existing
          ? await supabase.from('posts').update(payload).eq('id', existing.id).select().single()
          : await supabase.from('posts').insert({ ...payload, created_by: profile?.id }).select().single()
        if (res.error) throw new Error(`${account.account_name}: ${res.error.message}`)
        await persistAssets(res.data.id)
        saved.push(res.data)
      }
      const removed = rows.filter(r => !selectedIds.includes(r.account_id))
      if (removed.length) await supabase.from('posts').delete().in('id', removed.map(r => r.id))
      setRows(saved)
      return saved
    } catch (err) {
      showToast('error', err.message || 'Failed to save')
      return null
    } finally {
      setSaving(false)
    }
  }

  const chosenTime = () => (date && time ? DateTime.fromISO(`${date}T${time}`) : null)

  function guard({ needTime } = {}) {
    if (!selectedAccounts.length) { showToast('error', 'Pick at least one account'); return false }
    if (problems.length) { showToast('error', `${problems[0].account.account_name}: ${problems[0].list[0]}`); return false }
    if (needTime) {
      const at = chosenTime()
      if (!at) { showToast('error', 'Pick a date and time'); return false }
      if (at < DateTime.now()) { showToast('error', 'That time has passed — pick a future time or Publish now'); return false }
    }
    return true
  }

  async function handleDraft() {
    const at = chosenTime()
    const saved = await saveGroup('draft', () => at?.toISO() || null)
    if (saved) showToast('success', 'Draft saved')
  }

  async function handleSchedule() {
    if (!guard({ needTime: true })) return
    const at = chosenTime().toISO()
    if (mustRequestApproval) return submitForApproval(() => at)
    const saved = await saveGroup('scheduled', () => at)
    if (saved) { showToast('success', 'Scheduled'); navigate('/social/calendar') }
  }

  async function handleQueue() {
    if (!guard()) return
    const times = {}
    for (const a of selectedAccounts) {
      const slot = await nextQueueSlot(a)
      if (!slot) { showToast('error', `${a.account_name} has no posting schedule yet — set one in Planner → Posting schedule`); return }
      times[a.id] = slot.toISO()
    }
    if (mustRequestApproval) return submitForApproval(a => times[a.id])
    const saved = await saveGroup('scheduled', a => times[a.id])
    if (saved) {
      const first = Object.values(times).sort()[0]
      showToast('success', `Added to the queue — first slot ${DateTime.fromISO(first).toFormat('ccc d LLL, HH:mm')}`)
      navigate('/social/calendar')
    }
  }

  async function handlePublishNow() {
    if (!guard()) return
    if (!window.confirm(`Publish now to ${selectedAccounts.map(a => a.account_name).join(', ')}?`)) return
    const nowIso = new Date().toISOString()
    const saved = await saveGroup('scheduled', () => nowIso)
    if (!saved) return
    setSaving(true)
    const failures = []
    for (const row of saved) {
      const account = accounts.find(a => a.id === row.account_id)
      if (account?.mode === 'automated') {
        const { data, error } = await supabase.functions.invoke('sm-publish', { body: { post_id: row.id } })
        if (error || !data?.success) failures.push(`${account.account_name}: ${data?.error || 'failed'}`)
      } else {
        await supabase.from('posts').update({ status: 'ready_to_post' }).eq('id', row.id)
      }
    }
    setSaving(false)
    if (failures.length) showToast('error', failures.join(' · '))
    else showToast('success', 'Published')
    navigate('/social/calendar')
  }

  async function submitForApproval(timeFor) {
    const saved = await saveGroup('pending_approval', timeFor)
    if (!saved) return
    await supabase.from('post_approval_history').insert({ post_id: saved[0].id, action: 'submitted', actor_id: profile?.id })
    await supabase.functions.invoke('sm-notify-event', { body: { event: 'approval_requested', post_id: saved[0].id, actor_id: profile?.id } }).catch(() => {})
    showToast('success', 'Submitted for approval')
    navigate('/social/approvals')
  }

  async function saveTemplate(extra) {
    const account = templateRow ? accounts.find(a => a.id === templateRow.account_id) || accounts[0] : selectedAccounts[0] || accounts[0]
    if (!account) { showToast('error', 'Connect an account first'); return null }
    const payload = { ...baseFields(account), status: 'draft', scheduled_at: null, is_template: true, recurrence: null, ...extra }
    const res = templateRow
      ? await supabase.from('posts').update(payload).eq('id', templateRow.id).select().single()
      : await supabase.from('posts').insert({ ...payload, created_by: profile?.id }).select().single()
    if (res.error) { showToast('error', res.error.message); return null }
    await persistAssets(res.data.id)
    return res.data
  }

  async function handleSaveAsTemplate() {
    const name = window.prompt('Template name?')
    if (!name) return
    const saved = await saveTemplate({ template_name: name, autolist_id: null })
    if (saved) { showToast('success', 'Saved as template'); setTemplates(t => [...t, saved]) }
  }

  async function addToAutolist(list) {
    setShowAutolistPick(false)
    if (problems.length) { showToast('error', 'Fix the issues listed above first'); return }
    const saved = await saveTemplate({ template_name: (caption || 'Evergreen post').slice(0, 60), autolist_id: list.id })
    if (!saved) return
    const { count } = await supabase.from('autolist_items').select('id', { count: 'exact', head: true }).eq('autolist_id', list.id)
    const { error } = await supabase.from('autolist_items').insert({ autolist_id: list.id, post_id: saved.id, position: count || 0 })
    if (error) { showToast('error', error.message); return }
    showToast('success', `Added to the autolist "${list.name}"`)
  }

  async function updateTemplate() {
    const saved = await saveTemplate({})
    if (saved) showToast('success', templateRow.autolist_id ? 'Autolist post updated' : 'Template updated')
  }

  // A published post can't be edited; copy it into a fresh, unsaved post.
  function duplicateAsNew() {
    setRows([])
    setDate(''); setTime('')
    // URL only (no router navigation, which would reload and clear the form).
    window.history.replaceState({}, '', '/social/composer')
    showToast('success', 'Copied into a new post — pick a time and schedule it')
  }

  if (loading) {
    return <div><div className="page-header"><h1 className="page-title">Create post</h1></div><div className="skeleton skeleton-card" style={{ height: 420 }} /></div>
  }

  const previewAccount = accounts.find(a => a.id === previewId) || selectedAccounts[0]
  const anyAutomated = selectedAccounts.some(a => a.mode === 'automated')
  const supportsFirstComment = selectedAccounts.some(a => capabilitiesOf(a).firstComment)
  const allowedTypes = selectedAccounts.length
    ? Object.keys(POST_TYPE_LABELS).filter(t => selectedAccounts.every(a => platformOf(a).postTypes.includes(t)))
    : Object.keys(POST_TYPE_LABELS)

  return (
    <div className="composer-page">
      <div className="page-header">
        <h1 className="page-title">{templateRow ? (templateRow.autolist_id ? 'Edit autolist post' : 'Edit template') : rows.length ? 'Edit post' : 'Create post'}</h1>
        {rows.length > 0 && <p className="page-subtitle"><span className={`status-badge status-${groupStatus}`}>{STATUS_TEXT[groupStatus]}</span></p>}
      </div>

      {locked && (
        <div className="composer-banner composer-banner-ok">
          Published{rows.filter(r => r.external_post_url).map(r => (
            <span key={r.id}> · <a href={r.external_post_url} target="_blank" rel="noopener noreferrer">View on {accounts.find(a => a.id === r.account_id)?.account_name || 'the network'}</a></span>
          ))}. Changes here won't update what's live. <button className="btn btn-secondary btn-sm" onClick={duplicateAsNew}>Duplicate as a new post</button>
          {rows.some(r => r.first_comment_error) && <div>First comment failed: {rows.find(r => r.first_comment_error).first_comment_error}</div>}
        </div>
      )}
      {rows.filter(r => r.status === 'failed' && r.publish_error).map(r => (
        <div key={r.id} className="composer-banner composer-banner-error">
          {accounts.find(a => a.id === r.account_id)?.account_name}: {r.publish_error}. Fix it and schedule again, or retry from the Planner.
        </div>
      ))}

      <div className="composer-layout">
        <div className="composer-form">
          {/* Accounts */}
          <div className="section-card">
            <div className="section-card-header">
              <h2 className="section-card-title">Post to</h2>
              {templates.length > 0 && !templateRow && !locked && (
                <select className="form-input composer-template-select" defaultValue="" onChange={e => { if (e.target.value) loadTemplate(e.target.value); e.target.value = '' }}>
                  <option value="">Load a template…</option>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.template_name}</option>)}
                </select>
              )}
            </div>
            {templateRow ? (
              <p className="composer-hint">{templateRow.autolist_id ? "Autolist posts go to the autolist's accounts." : 'Templates can be reused for any account.'}</p>
            ) : (
              <div className="cp-accounts">
                {accounts.map(a => (
                  <button key={a.id} className={`cp-account ${selectedIds.includes(a.id) ? 'on' : ''}`} onClick={() => !a.readOnly && toggleAccount(a.id)} disabled={locked || a.readOnly} title={a.readOnly ? "You can't post as this account" : ''}>
                    <AccountAvatar account={a} size={30} />
                    <span className="cp-account-text"><b>{a.account_name}</b><small>{platformOf(a).name} {accountKindLabel(a)} · {a.mode === 'automated' ? 'auto-publish' : 'manual'}</small></span>
                  </button>
                ))}
                {accounts.length === 0 && <p className="composer-hint">No accounts yet — connect one in Settings → Integrations.</p>}
              </div>
            )}
          </div>

          {/* Format */}
          <div className="section-card">
            <h2 className="section-card-title">Format</h2>
            <div className="composer-type-pills">
              {Object.entries(POST_TYPE_LABELS).map(([k, label]) => (
                <button key={k} className={`lib-type-pill ${postType === k ? 'active' : ''}`} onClick={() => setPostType(k)} disabled={locked || !allowedTypes.includes(k)} title={allowedTypes.includes(k) ? '' : 'Not supported by every selected network'}>{label}</button>
              ))}
            </div>
          </div>

          {/* Text with per-account overrides */}
          <div className="section-card">
            <div className="section-card-header">
              <h2 className="section-card-title">Text</h2>
              {selectedAccounts.length > 1 && (
                <div className="sm-tabs cp-caption-tabs">
                  <button className={`sm-tab ${captionTab === 'all' ? 'active' : ''}`} onClick={() => setCaptionTab('all')}>All</button>
                  {selectedAccounts.map(a => (
                    <button key={a.id} className={`sm-tab ${captionTab === a.id ? 'active' : ''}`} onClick={() => setCaptionTab(a.id)} title={a.account_name}>
                      <PlatformIcon platform={a.platform} size={14} /> {a.account_name.split(' ')[0]}{overrides[a.id] !== undefined ? ' •' : ''}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {captionTab !== 'all' && !editingOverride ? (
              <div className="cp-override-off">
                <p className="composer-hint">{tabAccount?.account_name} uses the shared text.</p>
                <button className="btn btn-secondary btn-sm" onClick={() => setOverrides(o => ({ ...o, [captionTab]: caption }))} disabled={locked}>Customize for {tabAccount?.account_name}</button>
              </div>
            ) : (
              <>
                <textarea className="form-input composer-textarea" rows={8} value={activeText} onChange={e => setActiveText(e.target.value)} disabled={locked}
                  placeholder={captionTab === 'all' ? 'What do you want to share?' : `Text just for ${tabAccount?.account_name}…`} />
                <div className="cp-text-foot">
                  {editingOverride && <button className="btn btn-secondary btn-sm" onClick={() => setOverrides(o => { const n = { ...o }; delete n[captionTab]; return n })}>Use the shared text</button>}
                  <span className={`composer-char-count ${textLength > activeLimit ? 'over' : ''}`}>{textLength.toLocaleString()} / {activeLimit.toLocaleString()}</span>
                </div>
              </>
            )}
            <div className="form-group" style={{ marginTop: 'var(--space-sm)' }}>
              <label className="form-label">Hashtags</label>
              <input className="form-input" value={hashtagInput} onChange={e => setHashtagInput(e.target.value)} placeholder="#AI #KenyaBusiness" disabled={locked} />
              {hashtagSets.length > 0 && !locked && (
                <select className="form-input" style={{ marginTop: 6 }} defaultValue="" onChange={e => { if (e.target.value) applyHashtagSet(e.target.value); e.target.value = '' }}>
                  <option value="">Insert a saved hashtag set…</option>
                  {hashtagSets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
            </div>
          </div>

          {postType === 'poll' && (
            <div className="section-card">
              <h2 className="section-card-title">Poll</h2>
              <div className="form-group">
                <label className="form-label">Question ({pollQuestion.trim().length} / 140)</label>
                <input className="form-input" value={pollQuestion} maxLength={140} onChange={e => setPollQuestion(e.target.value)} disabled={locked} />
              </div>
              <div className="composer-two-col">
                <div>
                  <label className="form-label">Options (up to 30 characters)</label>
                  {pollOptions.map((o, i) => (
                    <input key={i} className="form-input" style={{ marginBottom: 6 }} maxLength={30} value={o} placeholder={`Option ${i + 1}`} disabled={locked}
                      onChange={e => setPollOptions(p => p.map((x, idx) => idx === i ? e.target.value : x))} />
                  ))}
                  {pollOptions.length < 4 && !locked && <button className="btn btn-secondary btn-sm" onClick={() => setPollOptions(p => [...p, ''])}>+ Option</button>}
                </div>
                <div className="form-group">
                  <label className="form-label">Runs for</label>
                  <select className="form-input" value={pollDuration} onChange={e => setPollDuration(e.target.value)} disabled={locked}>
                    <option value="ONE_DAY">1 day</option><option value="THREE_DAYS">3 days</option>
                    <option value="SEVEN_DAYS">1 week</option><option value="FOURTEEN_DAYS">2 weeks</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {['image', 'video', 'carousel'].includes(postType) && (
            <div className="section-card">
              <div className="section-card-header">
                <h2 className="section-card-title">Media</h2>
                {!locked && <button className="btn btn-secondary btn-sm" onClick={openAssetPicker}>Choose from Library</button>}
              </div>
              {selectedAssets.length === 0 ? <p className="composer-hint">No media selected yet.</p> : (
                <div className="composer-selected-media">
                  {selectedAssets.map(a => (
                    <div key={a.id} className="composer-selected-item">
                      {a.previewUrl ? <img src={a.previewUrl} alt="" /> : <span className="lib-card-icon">{a.file_type === 'video' ? '🎬' : '📄'}</span>}
                      {!locked && <button className="composer-remove-media" onClick={() => setSelectedAssets(p => p.filter(x => x.id !== a.id))}>&times;</button>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {supportsFirstComment && (
            <div className="section-card">
              <h2 className="section-card-title">First comment <span className="cp-optional">optional</span></h2>
              <textarea className="form-input" rows={2} value={firstComment} onChange={e => setFirstComment(e.target.value)} disabled={locked}
                placeholder="Posted as the account right after publishing — good for links and extra hashtags" />
            </div>
          )}

          <div className="section-card">
            <h2 className="section-card-title">Link, pillar &amp; campaign</h2>
            <div className="form-group">
              <label className="form-label">Link to track (adds UTM tags)</label>
              <input className="form-input" value={rawLink} onChange={e => setRawLink(e.target.value)} placeholder="https://sdfmgroup.com/..." disabled={locked} />
              {rawLink && !isValidUrl(rawLink) && <span className="form-error">Enter a full URL, e.g. https://…</span>}
              {utmUrl && (
                <div className="composer-utm-output">
                  <span>{utmUrl}</span>
                  <button className="btn btn-secondary btn-sm" onClick={() => { navigator.clipboard?.writeText(utmUrl); showToast('success', 'Copied — paste it into the text') }}>Copy</button>
                </div>
              )}
            </div>
            <div className="composer-two-col">
              <div className="form-group">
                <label className="form-label">Content pillar</label>
                <select className="form-input" value={pillarId} onChange={e => e.target.value === '__new__' ? setNewName({ kind: 'pillar', value: '' }) : setPillarId(e.target.value)} disabled={locked}>
                  <option value="">None</option>
                  {pillars.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  <option value="__new__">+ New pillar…</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Campaign</label>
                <select className="form-input" value={campaignId} onChange={e => e.target.value === '__new__' ? setNewName({ kind: 'campaign', value: '' }) : setCampaignId(e.target.value)} disabled={locked}>
                  <option value="">None</option>
                  {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  <option value="__new__">+ New campaign…</option>
                </select>
              </div>
            </div>
          </div>

          {/* When */}
          {!templateRow && !locked && (
            <div className="section-card">
              <h2 className="section-card-title">When</h2>
              <div className="composer-two-col">
                <div className="form-group"><label className="form-label">Date</label><input type="date" className="form-input" value={date} onChange={e => setDate(e.target.value)} /></div>
                <div className="form-group"><label className="form-label">Time</label><input type="time" className="form-input" value={time} onChange={e => setTime(e.target.value)} /></div>
              </div>
              <label className="cp-check">
                <input type="checkbox" checked={!!repeat} onChange={e => setRepeat(e.target.checked ? { freq: 'weekly', interval: 1, until: '' } : null)} /> Repeat this post
              </label>
              {repeat && (
                <div className="cp-repeat">
                  <span>Every</span>
                  <input type="number" min="1" max="12" className="form-input" value={repeat.interval} onChange={e => setRepeat(r => ({ ...r, interval: Math.max(1, Number(e.target.value) || 1) }))} />
                  <select className="form-input" value={repeat.freq} onChange={e => setRepeat(r => ({ ...r, freq: e.target.value }))}>
                    <option value="daily">day(s)</option><option value="weekly">week(s)</option><option value="monthly">month(s)</option>
                  </select>
                  <span>until</span>
                  <input type="date" className="form-input" value={repeat.until || ''} onChange={e => setRepeat(r => ({ ...r, until: e.target.value }))} />
                  <span className="composer-hint">(empty = keeps going)</span>
                </div>
              )}
            </div>
          )}

          {problems.length > 0 && !locked && (
            <div className="cp-problems">
              {problems.map(p => (
                <div key={p.account.id}><PlatformIcon platform={p.account.platform} size={14} /> <b>{p.account.account_name}:</b> {p.list.join(' · ')}</div>
              ))}
            </div>
          )}

          <div className="composer-actions">
            {templateRow ? (
              <button className="btn btn-primary" onClick={updateTemplate} disabled={saving}>Save</button>
            ) : locked ? null : (
              <>
                <button className="btn btn-secondary" onClick={handleSaveAsTemplate} disabled={saving}>Save as template</button>
                {autolists.length > 0 && <button className="btn btn-secondary" onClick={() => setShowAutolistPick(true)} disabled={saving}>♻ Add to autolist</button>}
                <button className="btn btn-secondary" onClick={handleDraft} disabled={saving}>Save draft</button>
                <button className="btn btn-secondary" onClick={handleQueue} disabled={saving}>Add to queue</button>
                {!mustRequestApproval && anyAutomated && <button className="btn btn-secondary" onClick={handlePublishNow} disabled={saving}>Publish now</button>}
                <button className="btn btn-primary" onClick={handleSchedule} disabled={saving}>{mustRequestApproval ? 'Submit for approval' : 'Schedule'}</button>
              </>
            )}
          </div>
        </div>

        {/* Previews */}
        <div className="composer-preview">
          <div className="cp-preview-head">
            {selectedAccounts.length > 1 && (
              <select className="form-input form-input-sm" value={previewAccount?.id || ''} onChange={e => setPreviewId(e.target.value)}>
                {selectedAccounts.map(a => <option key={a.id} value={a.id}>{platformOf(a).name} · {a.account_name}</option>)}
              </select>
            )}
            <div className="sm-tabs">
              {['desktop', 'mobile'].map(d => <button key={d} className={`sm-tab ${device === d ? 'active' : ''}`} onClick={() => setDevice(d)}>{d === 'desktop' ? 'Desktop' : 'Mobile'}</button>)}
            </div>
          </div>
          {previewAccount ? (
            <PostPreview account={previewAccount} caption={captionFor(previewAccount.id)} hashtags={hashtags} postType={postType}
              assets={selectedAssets} device={device} firstComment={capabilitiesOf(previewAccount).firstComment ? firstComment : ''}
              pollQuestion={pollQuestion} pollOptions={pollOptions} />
          ) : <p className="composer-hint">Pick an account to see the preview.</p>}
        </div>
      </div>

      {showAssetPicker && (
        <div className="modal-overlay" onClick={() => setShowAssetPicker(false)}>
          <div className="modal-card modal-card-wide" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Choose from Library</h3>
            <div className="lib-grid composer-picker-grid">
              {libraryAssets.map(a => (
                <button key={a.id} className={`lib-card ${selectedAssets.some(s => s.id === a.id) ? 'selected' : ''}`} onClick={() => toggleAsset(a)}>
                  <div className="lib-card-thumb">{a.file_type === 'image' && libSignedUrls[a.file_path] ? <img src={libSignedUrls[a.file_path]} alt="" /> : <span className="lib-card-icon">{a.file_type === 'video' ? '🎬' : '📄'}</span>}</div>
                  <div className="lib-card-name">{a.file_name}</div>
                </button>
              ))}
              {libraryAssets.length === 0 && <p className="composer-hint">The Library is empty — upload files in Library first.</p>}
            </div>
            <div className="modal-actions"><button className="btn btn-primary" onClick={() => setShowAssetPicker(false)}>Done</button></div>
          </div>
        </div>
      )}

      {showAutolistPick && (
        <div className="modal-overlay" onClick={() => setShowAutolistPick(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Add to autolist</h3>
            <p className="modal-subtitle">The post joins the rotation and goes out in the autolist's time slots.</p>
            {autolists.map(l => <button key={l.id} className="btn btn-secondary" style={{ display: 'block', width: '100%', marginBottom: 6 }} onClick={() => addToAutolist(l)}>{l.name}{!l.active ? ' (paused)' : ''}</button>)}
            <div className="modal-actions"><button className="btn btn-secondary" onClick={() => setShowAutolistPick(false)}>Cancel</button></div>
          </div>
        </div>
      )}

      {newName.kind && (
        <div className="modal-overlay" onClick={() => setNewName({ kind: '', value: '' })}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">New {newName.kind}</h3>
            <input className="form-input" value={newName.value} onChange={e => setNewName(n => ({ ...n, value: e.target.value }))} autoFocus onKeyDown={e => e.key === 'Enter' && createNamed()} />
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setNewName({ kind: '', value: '' })}>Cancel</button>
              <button className="btn btn-primary" onClick={createNamed}>Create</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast toast-${toast.type}`}>{toast.text}</div>}
    </div>
  )
}
