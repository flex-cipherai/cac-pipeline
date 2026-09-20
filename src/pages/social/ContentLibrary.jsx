import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import '../Dashboard.css'
import './ContentLibrary.css'

const BUCKET = 'content-library'

function fileTypeFor(file) {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  return 'document'
}

function typeIcon(type) {
  if (type === 'video') return '🎬'
  if (type === 'document') return '📄'
  return '🖼'
}

export default function ContentLibrary() {
  const { profile } = useAuth()
  const [assets, setAssets] = useState([])
  const [signedUrls, setSignedUrls] = useState({})
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [selected, setSelected] = useState(null)
  const [editTags, setEditTags] = useState('')
  const [editSourceProject, setEditSourceProject] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [toast, setToast] = useState({ show: false, type: '', text: '' })
  const fileInputRef = useRef(null)

  useEffect(() => { fetchAssets() }, [])

  useEffect(() => {
    if (toast.show) {
      const t = setTimeout(() => setToast({ show: false, type: '', text: '' }), 4000)
      return () => clearTimeout(t)
    }
  }, [toast.show])

  function showToast(type, text) { setToast({ show: true, type, text }) }

  async function fetchAssets() {
    setLoading(true)
    const { data, error } = await supabase.from('content_assets').select('*').order('created_at', { ascending: false })
    if (!error && data) {
      setAssets(data)
      const imagePaths = data.filter(a => a.file_type === 'image').map(a => a.file_path)
      if (imagePaths.length > 0) {
        const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(imagePaths, 3600)
        if (signed) {
          const map = {}
          signed.forEach(s => { if (s.path && s.signedUrl) map[s.path] = s.signedUrl })
          setSignedUrls(map)
        }
      }
    }
    setLoading(false)
  }

  async function handleUpload(e) {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    setUploading(true)
    let failed = 0
    for (const file of files) {
      const type = fileTypeFor(file)
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `${Date.now()}-${safeName}`
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file)
      if (uploadError) { failed++; continue }
      await supabase.from('content_assets').insert({
        file_path: path,
        file_name: file.name,
        file_type: type,
        file_size: file.size,
        uploaded_by: profile?.id,
      })
    }
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    showToast(failed > 0 ? 'error' : 'success', failed > 0 ? `${failed} file(s) failed to upload` : 'Upload complete')
    fetchAssets()
  }

  function openDetails(asset) {
    setSelected(asset)
    setEditTags((asset.tags || []).join(', '))
    setEditSourceProject(asset.source_project || '')
  }

  async function saveDetails() {
    if (!selected) return
    const tags = editTags.split(',').map(t => t.trim()).filter(Boolean)
    const { error } = await supabase.from('content_assets')
      .update({ tags, source_project: editSourceProject.trim() || null })
      .eq('id', selected.id)
    if (error) { showToast('error', 'Failed to save'); return }
    showToast('success', 'Asset updated')
    setSelected(null)
    fetchAssets()
  }

  async function handleDelete() {
    if (!selected) return
    setDeleting(true)
    await supabase.storage.from(BUCKET).remove([selected.file_path])
    const { error } = await supabase.from('content_assets').delete().eq('id', selected.id)
    setDeleting(false)
    if (error) { showToast('error', 'Failed to delete asset'); return }
    showToast('success', 'Asset deleted')
    setSelected(null)
    fetchAssets()
  }

  const filtered = assets.filter(a => {
    if (typeFilter !== 'all' && a.file_type !== typeFilter) return false
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return a.file_name.toLowerCase().includes(q)
      || (a.tags || []).some(t => t.toLowerCase().includes(q))
      || (a.source_project || '').toLowerCase().includes(q)
  })

  if (loading) {
    return (
      <div>
        <div className="page-header"><h1 className="page-title">Content Library</h1></div>
        <div className="dash-stats-row">{[1, 2, 3, 4].map(i => <div key={i} className="skeleton skeleton-card" />)}</div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header dash-header">
        <div>
          <h1 className="page-title">Content Library</h1>
          <p className="page-subtitle">{assets.length} asset{assets.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="dash-header-actions">
          <input ref={fileInputRef} type="file" multiple accept="image/*,video/*,.pdf,.doc,.docx" style={{ display: 'none' }} onChange={handleUpload} />
          <button className="btn btn-primary btn-sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </div>

      <div className="lib-filters">
        <input className="form-input lib-search" placeholder="Search by name, tag, or project…" value={search} onChange={e => setSearch(e.target.value)} />
        <div className="lib-type-pills">
          {[{ key: 'all', label: 'All' }, { key: 'image', label: 'Images' }, { key: 'video', label: 'Video' }, { key: 'document', label: 'Documents' }].map(f => (
            <button key={f.key} className={`lib-type-pill ${typeFilter === f.key ? 'active' : ''}`} onClick={() => setTypeFilter(f.key)}>{f.label}</button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="section-card">
          <div className="empty-state">
            <p className="empty-state-title">No assets yet</p>
            <p className="empty-state-desc">Upload images, videos, or documents to reuse them across posts.</p>
          </div>
        </div>
      ) : (
        <div className="lib-grid">
          {filtered.map(asset => (
            <button key={asset.id} className="lib-card" onClick={() => openDetails(asset)}>
              <div className="lib-card-thumb">
                {asset.file_type === 'image' && signedUrls[asset.file_path] ? (
                  <img src={signedUrls[asset.file_path]} alt={asset.file_name} />
                ) : (
                  <span className="lib-card-icon">{typeIcon(asset.file_type)}</span>
                )}
              </div>
              <div className="lib-card-name" title={asset.file_name}>{asset.file_name}</div>
              {(asset.tags || []).length > 0 && (
                <div className="lib-card-tags">
                  {asset.tags.slice(0, 3).map(t => <span key={t} className="lib-card-tag">{t}</span>)}
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="modal-overlay" onClick={() => !deleting && setSelected(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">{selected.file_name}</h3>
            <p className="modal-subtitle">{selected.file_type} · {selected.file_size ? `${Math.round(selected.file_size / 1024)} KB` : ''}</p>
            <div className="form-group">
              <label className="form-label">Tags (comma separated)</label>
              <input className="form-input" value={editTags} onChange={e => setEditTags(e.target.value)} placeholder="e.g. brand, launch, q1" />
            </div>
            <div className="form-group">
              <label className="form-label">Source project</label>
              <input className="form-input" value={editSourceProject} onChange={e => setEditSourceProject(e.target.value)} placeholder="e.g. FKE case study" />
            </div>
            <div className="modal-actions">
              <button className="btn btn-danger" onClick={handleDelete} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete'}</button>
              <button className="btn btn-secondary" onClick={() => setSelected(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveDetails}>Save</button>
            </div>
          </div>
        </div>
      )}

      {toast.show && (
        <div className={`toast toast-${toast.type}`}>{toast.text}</div>
      )}
    </div>
  )
}
