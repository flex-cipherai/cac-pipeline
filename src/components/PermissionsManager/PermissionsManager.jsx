import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { EDITABLE_ROLES, DELEGABLE_MODULES, MODULE_GROUPS, buildAccessMap, defaultAllowed } from '../../lib/permissions'
import './PermissionsManager.css'

function isMissingTable(error) {
  const msg = error?.message || ''
  return !!error && (error.code === '42P01' || error.code === 'PGRST205' || (/role_permissions/.test(msg) && /(does not exist|schema cache)/.test(msg)))
}

// A role's access as { moduleKey: boolean } for every editable role.
function mapsFromRows(rows) {
  return Object.fromEntries(EDITABLE_ROLES.map(r => [r.key, buildAccessMap(r.key, (rows || []).filter(x => x.role === r.key))]))
}

// Checkbox that can show "some of the group" (the group header's switch).
function GroupCheckbox({ checked, indeterminate, onChange, label }) {
  const ref = useRef(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate }, [indeterminate])
  return <input ref={ref} type="checkbox" checked={checked} onChange={onChange} aria-label={label} />
}

export default function PermissionsManager({ showToast }) {
  const { profile } = useAuth()
  const [saved, setSaved] = useState(null)   // what the database holds
  const [draft, setDraft] = useState(null)   // what the admin is editing
  const [enforced, setEnforced] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [setupNeeded, setSetupNeeded] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    const [permRes, flagRes] = await Promise.all([
      supabase.from('role_permissions').select('role, module, allowed'),
      supabase.from('system_settings').select('value').eq('key', 'permissions_enforced').maybeSingle(),
    ])
    if (permRes.error) {
      if (isMissingTable(permRes.error)) setSetupNeeded(true)
      else setError(permRes.error.message || 'Could not load permissions.')
    } else {
      const maps = mapsFromRows(permRes.data)
      setSaved(maps)
      setDraft(maps)
      setEnforced(flagRes.data?.value === 'true')
    }
    setLoading(false)
  }

  const changes = useMemo(() => {
    if (!saved || !draft) return []
    return EDITABLE_ROLES.flatMap(r => DELEGABLE_MODULES
      .filter(m => saved[r.key][m.key] !== draft[r.key][m.key])
      .map(m => ({ role: r, module: m, allowed: draft[r.key][m.key] })))
  }, [saved, draft])

  function setCell(roleKey, moduleKey, value) {
    setDraft(d => ({ ...d, [roleKey]: { ...d[roleKey], [moduleKey]: value } }))
  }

  function setGroup(roleKey, group, value) {
    setDraft(d => ({
      ...d,
      [roleKey]: { ...d[roleKey], ...Object.fromEntries(group.modules.filter(m => !m.adminOnly).map(m => [m.key, value])) },
    }))
  }

  function resetToDefaults() {
    setDraft(Object.fromEntries(EDITABLE_ROLES.map(r => [r.key, Object.fromEntries(DELEGABLE_MODULES.map(m => [m.key, defaultAllowed(r.key, m.key)]))])))
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    // Write every cell, not just the changed ones, so the table is always complete: the database policy
    // helper treats a missing row as "no access".
    const rows = EDITABLE_ROLES.flatMap(r => DELEGABLE_MODULES.map(m => ({
      role: r.key, module: m.key, allowed: !!draft[r.key][m.key], updated_by: profile?.id || null,
    })))
    const { error: err } = await supabase.from('role_permissions').upsert(rows, { onConflict: 'role,module' })
    setSaving(false)
    if (err) {
      setError(err.message || 'Could not save permissions.')
      showToast('error', 'Permissions were not saved')
      return
    }
    setSaved(draft)
    showToast('success', `Permissions saved (${changes.length} change${changes.length === 1 ? '' : 's'})`)
  }

  if (loading) {
    return <div className="section-card perm-card"><div className="skeleton skeleton-bar" /><div className="skeleton skeleton-bar" style={{ width: '70%' }} /></div>
  }

  if (setupNeeded) {
    return (
      <div className="section-card perm-card">
        <p className="perm-note">
          Permissions need a one-time database setup. In the Supabase SQL Editor, run <code>supabase/migration-role-permissions.sql</code> (safe to re-run), then reload this page.
          Until then every role keeps the access it had before.
        </p>
      </div>
    )
  }

  if (!draft) {
    return <div className="section-card perm-card"><p className="perm-error">{error || 'Permissions could not be loaded.'}</p></div>
  }

  return (
    <div className="section-card perm-card">
      {!enforced && (
        <div className="perm-callout" role="status">
          <strong>The database is not following this table yet.</strong>{' '}
          Right now these switches only change menus and pages: someone who is given a module can open it, but its data is still limited by the old database rules.
          Run <code>supabase/migration-permissions-enforcement.sql</code> in the Supabase SQL Editor, then reload this page.
        </div>
      )}

      <p className="perm-note">
        Choose which modules each role can open. A switched-off module disappears from that role's menu, its pages redirect away, and its data is no longer readable or changeable by them.
        Admins always have every module. The modules marked <em>Admin only</em> cannot be given to anyone else.
        People already signed in pick up a change when they next return to the app.
      </p>

      <div className="table-scroll">
        <table className="perm-table">
          <thead>
            <tr>
              <th scope="col">Module</th>
              <th scope="col" className="perm-role-col">Admin</th>
              {EDITABLE_ROLES.map(r => <th key={r.key} scope="col" className="perm-role-col">{r.label}</th>)}
            </tr>
          </thead>
          {MODULE_GROUPS.map(group => {
            const delegable = group.modules.filter(m => !m.adminOnly)
            return (
              <tbody key={group.key}>
                <tr className="perm-group-row">
                  <th scope="row">{group.label}</th>
                  <td className="perm-role-col"><span className="perm-locked" title="Admins always have every module">Always</span></td>
                  {EDITABLE_ROLES.map(r => {
                    const on = delegable.filter(m => draft[r.key][m.key]).length
                    return (
                      <td key={r.key} className="perm-role-col">
                        <GroupCheckbox
                          checked={on === delegable.length}
                          indeterminate={on > 0 && on < delegable.length}
                          onChange={e => setGroup(r.key, group, e.target.checked)}
                          label={`${r.label}: all ${group.label} modules`}
                        />
                      </td>
                    )
                  })}
                </tr>
                {group.modules.map(m => (
                  <tr key={m.key}>
                    <th scope="row" className="perm-module">
                      <span>{m.label}</span>
                      {m.hint && <small>{m.hint}</small>}
                    </th>
                    <td className="perm-role-col"><input type="checkbox" checked disabled aria-label={`Admin: ${m.label} (always on)`} /></td>
                    {EDITABLE_ROLES.map(r => {
                      if (m.adminOnly) {
                        return <td key={r.key} className="perm-role-col"><span className="perm-locked">Admin only</span></td>
                      }
                      const allowed = draft[r.key][m.key]
                      const changed = saved[r.key][m.key] !== allowed
                      return (
                        <td key={r.key} className={`perm-role-col ${changed ? 'perm-changed' : ''}`}>
                          <label className="perm-cell">
                            <input type="checkbox" checked={allowed} onChange={e => setCell(r.key, m.key, e.target.checked)} aria-label={`${r.label}: ${m.label}`} />
                          </label>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            )
          })}
        </table>
      </div>

      {error && <p className="perm-error">{error}</p>}

      <div className="perm-actions">
        <span className="perm-pending">{changes.length === 0 ? 'No unsaved changes' : `${changes.length} unsaved change${changes.length === 1 ? '' : 's'}`}</span>
        <button className="btn btn-secondary btn-sm" onClick={resetToDefaults} disabled={saving}>Reset to original access</button>
        <button className="btn btn-secondary btn-sm" onClick={() => setDraft(saved)} disabled={saving || changes.length === 0}>Discard</button>
        <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving || changes.length === 0}>{saving ? 'Saving...' : 'Save permissions'}</button>
      </div>
    </div>
  )
}
