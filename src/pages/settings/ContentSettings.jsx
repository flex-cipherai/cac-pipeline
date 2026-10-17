import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { SettingsHeading } from './SettingsLayout'
import useToast from './useToast'

const DEFAULTS = {
  sm_approval_workflow_enabled: 'false',
  sm_default_utm_source: 'linkedin',
  sm_default_utm_medium: 'social',
  sm_signature_link: '',
  app_base_url: '',
}

export default function ContentSettings() {
  const { showToast, toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [contentDefaults, setContentDefaults] = useState(DEFAULTS)
  const [savingDefaults, setSavingDefaults] = useState(false)
  const [hashtagSets, setHashtagSets] = useState([])
  const [newHashtagSetName, setNewHashtagSetName] = useState('')
  const [newHashtagSetTags, setNewHashtagSetTags] = useState('')

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    const [hashtagRes, defaultsRes] = await Promise.all([
      supabase.from('hashtag_sets').select('*').order('name'),
      supabase.from('system_settings').select('key, value').in('key', Object.keys(DEFAULTS)),
    ])
    if (hashtagRes.data) setHashtagSets(hashtagRes.data)
    if (defaultsRes.data) {
      const cfg = { ...DEFAULTS }
      defaultsRes.data.forEach(row => { if (row.key && row.value !== null) cfg[row.key] = row.value })
      setContentDefaults(cfg)
    }
    setLoading(false)
  }

  const setDefault = (key, value) => setContentDefaults(prev => ({ ...prev, [key]: value }))

  async function saveContentDefaults() {
    setSavingDefaults(true)
    const rows = Object.entries(contentDefaults).map(([key, value]) => ({ key, value: String(value) }))
    const { error } = await supabase.from('system_settings').upsert(rows, { onConflict: 'key' })
    setSavingDefaults(false)
    if (error) return showToast('error', 'Failed to save content defaults')
    showToast('success', 'Content defaults saved')
  }

  async function addHashtagSet() {
    if (!newHashtagSetName.trim()) return
    const hashtags = newHashtagSetTags.split(/[\s,]+/).map(h => h.replace(/^#/, '').trim()).filter(Boolean)
    const { data, error } = await supabase.from('hashtag_sets').insert({ name: newHashtagSetName.trim(), hashtags }).select().single()
    if (error) { showToast('error', 'Failed to add hashtag set'); return }
    setHashtagSets(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
    setNewHashtagSetName('')
    setNewHashtagSetTags('')
  }

  async function deleteHashtagSet(id) {
    const { error } = await supabase.from('hashtag_sets').delete().eq('id', id)
    if (error) { showToast('error', 'Failed to remove hashtag set'); return }
    setHashtagSets(prev => prev.filter(h => h.id !== id))
  }

  if (loading) {
    return (
      <div>
        <SettingsHeading title="Content defaults" />
        <div className="skeleton skeleton-card" style={{ height: 200 }} />
      </div>
    )
  }

  return (
    <div>
      <SettingsHeading title="Content defaults" hint="Defaults for new social posts, the app link used in emails, and reusable hashtag sets." />

      <div className="section-card" style={{ padding: 'var(--space-lg)' }}>
        <label className="checkbox-label" style={{ marginBottom: 'var(--space-md)' }}>
          <input
            type="checkbox"
            checked={contentDefaults.sm_approval_workflow_enabled === 'true'}
            onChange={e => setDefault('sm_approval_workflow_enabled', e.target.checked ? 'true' : 'false')}
          />
          Require Admin approval before posts can be scheduled
        </label>

        <div className="profile-edit-grid">
          <div className="form-group">
            <label className="form-label">Default UTM Source</label>
            <input className="form-input" value={contentDefaults.sm_default_utm_source} onChange={e => setDefault('sm_default_utm_source', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Default UTM Medium</label>
            <input className="form-input" value={contentDefaults.sm_default_utm_medium} onChange={e => setDefault('sm_default_utm_medium', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Signature Link</label>
            <input className="form-input" value={contentDefaults.sm_signature_link} onChange={e => setDefault('sm_signature_link', e.target.value)} placeholder="https://sdfmgroup.com" />
          </div>
          <div className="form-group">
            <label className="form-label">App URL (for links in emails)</label>
            <input className="form-input" value={contentDefaults.app_base_url} onChange={e => setDefault('app_base_url', e.target.value)} placeholder="https://your-site.netlify.app" />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--space-lg)' }}>
          <button className="btn btn-primary btn-sm" onClick={saveContentDefaults} disabled={savingDefaults}>{savingDefaults ? 'Saving...' : 'Save Defaults'}</button>
        </div>

        <h3 className="settings-disq-title" style={{ padding: 0, marginBottom: 'var(--space-sm)' }}>Hashtag Sets</h3>
        {hashtagSets.length > 0 && (
          <div className="sm-hashtag-list">
            {hashtagSets.map(set => (
              <div key={set.id} className="sm-hashtag-row">
                <div>
                  <strong>{set.name}</strong>
                  <span className="form-hint" style={{ marginLeft: 8 }}>{set.hashtags.map(h => `#${h}`).join(' ')}</span>
                </div>
                <button className="action-menu-item action-danger" style={{ width: 'auto', padding: '4px 8px' }} onClick={() => deleteHashtagSet(set.id)}>Remove</button>
              </div>
            ))}
          </div>
        )}
        <div className="profile-edit-grid" style={{ marginTop: 'var(--space-sm)' }}>
          <div className="form-group">
            <label className="form-label">New Set Name</label>
            <input className="form-input" value={newHashtagSetName} onChange={e => setNewHashtagSetName(e.target.value)} placeholder="e.g. Case Studies" />
          </div>
          <div className="form-group">
            <label className="form-label">Hashtags</label>
            <input className="form-input" value={newHashtagSetTags} onChange={e => setNewHashtagSetTags(e.target.value)} placeholder="#AI #KenyaBusiness" />
          </div>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={addHashtagSet}>Add Hashtag Set</button>
      </div>

      {toast}
    </div>
  )
}
