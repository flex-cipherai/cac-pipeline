import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import './ContentLibrary.css'
import './BulkScheduler.css'

const BUCKET = 'content-library'

function normalizeKey(key) {
  return String(key || '').trim().toLowerCase().replace(/[\s_]+/g, '_')
}

function fileTypeFor(file) {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  return 'document'
}

function parseDate(value) {
  if (!value) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const str = String(value).trim()
  const parsed = new Date(str)
  return isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}

function parseTime(value) {
  if (!value) return null
  const str = String(value).trim()
  const match = str.match(/^(\d{1,2}):(\d{2})/)
  if (!match) return null
  const h = String(match[1]).padStart(2, '0')
  return `${h}:${match[2]}`
}

export default function BulkScheduler() {
  const navigate = useNavigate()
  const { profile } = useAuth()

  const mediaInputRef = useRef(null)
  const [uploadingMedia, setUploadingMedia] = useState(false)
  const [mediaUploaded, setMediaUploaded] = useState([])

  const sheetInputRef = useRef(null)
  const [rows, setRows] = useState([])
  const [validation, setValidation] = useState([])
  const [importing, setImporting] = useState(false)
  const [imported, setImported] = useState(null)
  const [toast, setToast] = useState({ show: false, type: '', text: '' })

  function showToast(type, text) { setToast({ show: true, type, text }); setTimeout(() => setToast({ show: false, type: '', text: '' }), 4000) }

  // ── Step 1: bulk media upload ──
  async function handleMediaUpload(e) {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    setUploadingMedia(true)
    const uploaded = []
    for (const file of files) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `${Date.now()}-${safeName}`
      const { error } = await supabase.storage.from(BUCKET).upload(path, file)
      if (error) continue
      await supabase.from('content_assets').insert({
        file_path: path, file_name: file.name, file_type: fileTypeFor(file), file_size: file.size, uploaded_by: profile?.id,
      })
      uploaded.push(file.name)
    }
    setUploadingMedia(false)
    setMediaUploaded(prev => [...prev, ...uploaded])
    if (mediaInputRef.current) mediaInputRef.current.value = ''
    showToast('success', `${uploaded.length} file(s) added to the library`)
  }

  // ── Step 2: spreadsheet import ──
  async function handleSheetSelect(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: 'array' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const raw = XLSX.utils.sheet_to_json(sheet, { defval: '' })

    const normalized = raw.map(r => {
      const row = {}
      Object.entries(r).forEach(([k, v]) => { row[normalizeKey(k)] = v })
      return {
        date: row.date, time: row.time, copy: row.copy || row.caption,
        media_reference: row.media_reference || row.media,
        pillar: row.pillar, campaign: row.campaign, hashtags: row.hashtags,
      }
    })
    setRows(normalized)
    await validateRows(normalized)
    if (sheetInputRef.current) sheetInputRef.current.value = ''
  }

  async function validateRows(rowsToValidate) {
    const { data: assets } = await supabase.from('content_assets').select('file_name')
    const knownFiles = new Set((assets || []).map(a => a.file_name))
    const { data: pillars } = await supabase.from('content_pillars').select('name')
    const knownPillars = new Set((pillars || []).map(p => p.name.toLowerCase()))
    const { data: campaigns } = await supabase.from('content_campaigns').select('name')
    const knownCampaigns = new Set((campaigns || []).map(c => c.name.toLowerCase()))

    const seenSlots = new Set()
    const results = rowsToValidate.map((row, i) => {
      const issues = []
      const date = parseDate(row.date)
      const time = parseTime(row.time)
      if (!date) issues.push({ level: 'error', text: 'Unrecognized date' })
      if (!time) issues.push({ level: 'error', text: 'Unrecognized time' })
      if (!row.copy || !String(row.copy).trim()) issues.push({ level: 'error', text: 'Missing caption' })
      if (String(row.copy || '').length > 3000) issues.push({ level: 'error', text: 'Caption exceeds 3000 characters' })

      if (date && time) {
        const slotKey = `${date} ${time}`
        if (seenSlots.has(slotKey)) issues.push({ level: 'error', text: `Duplicate time slot with another row (${slotKey})` })
        seenSlots.add(slotKey)
      }
      if (row.media_reference && !knownFiles.has(String(row.media_reference).trim())) {
        issues.push({ level: 'warning', text: `Media "${row.media_reference}" not found in library — post will be created without it` })
      }
      if (row.pillar && !knownPillars.has(String(row.pillar).trim().toLowerCase())) {
        issues.push({ level: 'warning', text: `Pillar "${row.pillar}" will be created` })
      }
      if (row.campaign && !knownCampaigns.has(String(row.campaign).trim().toLowerCase())) {
        issues.push({ level: 'warning', text: `Campaign "${row.campaign}" will be created` })
      }

      return { index: i, row, date, time, issues, hasError: issues.some(x => x.level === 'error') }
    })
    setValidation(results)
  }

  async function resolvePillar(name, cache) {
    if (!name) return null
    const key = name.trim().toLowerCase()
    if (cache.has(key)) return cache.get(key)
    const { data: existing } = await supabase.from('content_pillars').select('id').ilike('name', name.trim()).maybeSingle()
    if (existing) { cache.set(key, existing.id); return existing.id }
    const { data: created } = await supabase.from('content_pillars').insert({ name: name.trim() }).select().single()
    cache.set(key, created?.id || null)
    return created?.id || null
  }

  async function resolveCampaign(name, cache) {
    if (!name) return null
    const key = name.trim().toLowerCase()
    if (cache.has(key)) return cache.get(key)
    const { data: existing } = await supabase.from('content_campaigns').select('id').ilike('name', name.trim()).maybeSingle()
    if (existing) { cache.set(key, existing.id); return existing.id }
    const { data: created } = await supabase.from('content_campaigns').insert({ name: name.trim() }).select().single()
    cache.set(key, created?.id || null)
    return created?.id || null
  }

  async function handleImport() {
    const importable = validation.filter(v => !v.hasError)
    if (importable.length === 0) { showToast('error', 'No valid rows to import'); return }

    setImporting(true)
    const { data: account } = await supabase.from('connected_accounts').select('*').eq('platform', 'linkedin').maybeSingle()
    const { data: assetRows } = await supabase.from('content_assets').select('id, file_name')
    const assetByName = new Map((assetRows || []).map(a => [a.file_name, a.id]))
    const pillarCache = new Map()
    const campaignCache = new Map()

    let success = 0, failed = 0
    for (const v of importable) {
      const pillarId = await resolvePillar(v.row.pillar, pillarCache)
      const campaignId = await resolveCampaign(v.row.campaign, campaignCache)
      const hashtags = String(v.row.hashtags || '').split(/[\s,]+/).map(h => h.replace(/^#/, '').trim()).filter(Boolean)
      const scheduledAt = new Date(`${v.date}T${v.time}`).toISOString()

      const { data: post, error } = await supabase.from('posts').insert({
        account_id: account?.id || null,
        post_type: v.row.media_reference ? 'image' : 'text',
        caption: String(v.row.copy || ''),
        hashtags,
        pillar_id: pillarId,
        campaign_id: campaignId,
        status: 'scheduled',
        scheduled_at: scheduledAt,
        mode: account?.mode || 'assisted',
        created_by: profile?.id,
      }).select().single()

      if (error || !post) { failed++; continue }
      const assetId = v.row.media_reference ? assetByName.get(String(v.row.media_reference).trim()) : null
      if (assetId) await supabase.from('post_assets').insert({ post_id: post.id, asset_id: assetId, position: 0 })
      success++
    }

    setImporting(false)
    setImported({ success, failed })
    showToast(failed > 0 ? 'error' : 'success', `Imported ${success} post(s)${failed > 0 ? `, ${failed} failed` : ''}`)
  }

  const errorCount = validation.filter(v => v.hasError).length
  const warningCount = validation.filter(v => !v.hasError && v.issues.length > 0).length

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Bulk Scheduling</h1>
        <p className="page-subtitle">Upload media, then a spreadsheet mapped to date, time, copy, media, pillar, campaign, and hashtags.</p>
      </div>

      <div className="section-card">
        <div className="section-card-header"><h2 className="section-card-title">1. Bulk Media Upload (optional)</h2></div>
        <p className="composer-hint">Upload a folder of media first so the spreadsheet's media column can match by filename.</p>
        <input ref={mediaInputRef} type="file" multiple accept="image/*,video/*" style={{ display: 'none' }} onChange={handleMediaUpload} />
        <button className="btn btn-secondary btn-sm" style={{ marginTop: 'var(--space-sm)' }} onClick={() => mediaInputRef.current?.click()} disabled={uploadingMedia}>
          {uploadingMedia ? 'Uploading…' : 'Upload Media Files'}
        </button>
        {mediaUploaded.length > 0 && <p className="composer-hint" style={{ marginTop: 6 }}>{mediaUploaded.length} file(s) uploaded this session.</p>}
      </div>

      <div className="section-card">
        <div className="section-card-header"><h2 className="section-card-title">2. Spreadsheet Import</h2></div>
        <p className="composer-hint">Columns: date, time, copy, media_reference (filename), pillar, campaign, hashtags. CSV or XLSX.</p>
        <input ref={sheetInputRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} onChange={handleSheetSelect} />
        <button className="btn btn-secondary btn-sm" style={{ marginTop: 'var(--space-sm)' }} onClick={() => sheetInputRef.current?.click()}>Choose File</button>
      </div>

      {validation.length > 0 && (
        <div className="section-card">
          <div className="section-card-header">
            <h2 className="section-card-title">Pre-Import Validation</h2>
            <span className="composer-hint">{errorCount} error{errorCount !== 1 ? 's' : ''} · {warningCount} warning{warningCount !== 1 ? 's' : ''} · {validation.length - errorCount} importable</span>
          </div>
          <div className="bulk-table-wrap">
            <table className="data-table">
              <thead><tr><th>#</th><th>Date</th><th>Time</th><th>Caption</th><th>Issues</th></tr></thead>
              <tbody>
                {validation.map(v => (
                  <tr key={v.index} className={v.hasError ? 'row-deactivated' : ''}>
                    <td>{v.index + 1}</td>
                    <td>{v.date || v.row.date || '—'}</td>
                    <td>{v.time || v.row.time || '—'}</td>
                    <td>{String(v.row.copy || '').slice(0, 50)}</td>
                    <td>
                      {v.issues.length === 0 ? <span className="status-badge status-posted">OK</span> : v.issues.map((iss, i) => (
                        <div key={i} className={iss.level === 'error' ? 'bulk-issue-error' : 'bulk-issue-warning'}>{iss.text}</div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="modal-actions" style={{ marginTop: 'var(--space-md)' }}>
            <button className="btn btn-primary" onClick={handleImport} disabled={importing || validation.every(v => v.hasError)}>
              {importing ? 'Importing…' : `Import ${validation.length - errorCount} Post(s)`}
            </button>
          </div>
          {imported && (
            <p className="composer-hint" style={{ marginTop: 'var(--space-sm)' }}>
              Imported {imported.success} post(s). <button className="btn btn-secondary btn-sm" onClick={() => navigate('/social/calendar')}>Go to Calendar</button>
            </p>
          )}
        </div>
      )}

      {toast.show && <div className={`toast toast-${toast.type}`}>{toast.text}</div>}
    </div>
  )
}
