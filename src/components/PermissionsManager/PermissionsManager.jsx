import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { EDITABLE_ROLES, MODULES, MODULE_GROUPS, buildAccessMap, defaultAllowed, needsDatabaseGrant } from '../../lib/permissions'
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
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [setupNeeded, setSetupNeeded] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    const { data, error: err } = await supabase.from('role_permissions').select('role, module, allowed')
    if (err) {
      if (isMissingTable(err)) setSetupNeeded(true)
      else setError(err.message || 'Could not load permissions.')
    } else {
      const maps = mapsFromRows(data)
      setSaved(maps)
      setDraft(maps)
    }
    setLoading(false)
  }

  const changes = useMemo(() => {
    if (!saved || !draft) return []
    return EDITABLE_ROLES.flatMap(r => MODULES
      .filter(m => saved[r.key][m.key] !== draft[r.key][m.key])
      .map(m => ({ role: r, module: m, allowed: draft[r.key][m.key] })))
  }, [saved, draft])

  // Cells that are switched on but whose pages will not fully work for that role.
  const unsupported = useMemo(() => {
    if (!draft) return []
    return EDITABLE_ROLES.flatMap(r => MODULES
      .filter(m => draft[r.key][m.key] && needsDatabaseGrant(r.key, m.key))
      .map(m => ({ role: r, module: m })))
  }, [draft])

  function setCell(roleKey, moduleKey, value) {
    setDraft(d => ({ ...d, [roleKey]: { ...d[roleKey], [moduleKey]: value } }))
  }

  function setGroup(roleKey, group, value) {
    setDraft(d => ({
      ...d,
      [roleKey]: { ...d[roleKey], ...Object.fromEntries(group.modules.map(m => [m.key, value])) },
    }))
  }

  function resetToDefaults() {
    setDraft(Object.fromEntries(EDITABLE_ROLES.map(r => [r.key, Object.fromEntries(MODULES.map(m => [m.key, defaultAllowed(r.key, m.key)]))])))
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    // Write every cell, not just the changed ones, so the table is always complete: the database policy
    // helper treats a missing row as "no access".
    const rows = EDITABLE_ROLES.flatMap(r => MODULES.map(m => ({
      role: r.key, module: m.key, allowed: draft[r.key][m.key], updated_by: profile?.id || null,
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
      <p className="perm-note">
        Choose which modules each role can open. Switched-off modules disappear from that role's menu and their pages redirect away.
        Admins always have every module, and the Users, Scoring and Permissions sections of Settings are admin-only whatever is set here.
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
          {MODULE_GROUPS.map(group => (
            <tbody key={group.key}>
              <tr className="perm-group-row">
                <th scope="row">{group.label}</th>
                <td className="perm-role-col"><span className="perm-locked" title="Admins always have every module">Always</span></td>
                {EDITABLE_ROLES.map(r => {
                  const on = group.modules.filter(m => draft[r.key][m.key]).length
                  return (
                    <td key={r.key} className="perm-role-col">
                      <GroupCheckbox
                        checked={on === group.modules.length}
                        indeterminate={on > 0 && on < group.modules.length}
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
                    const allowed = draft[r.key][m.key]
                    const warn = allowed && needsDatabaseGrant(r.key, m.key)
                    const changed = saved[r.key][m.key] !== allowed
                    return (
                      <td key={r.key} className={`perm-role-col ${changed ? 'perm-changed' : ''}`}>
                        <label className="perm-cell">
                          <input type="checkbox" checked={allowed} onChange={e => setCell(r.key, m.key, e.target.checked)} aria-label={`${r.label}: ${m.label}`} />
                          {warn && <span className="perm-warn" title={`${r.label} has no database rights for ${m.label}, so this page will open but its data will not load or save.`} aria-hidden="true">!</span>}
                        </label>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      {unsupported.length > 0 && (
        <div className="perm-callout" role="status">
          <strong>{unsupported.length} switch{unsupported.length === 1 ? ' is' : 'es are'} on without database rights.</strong>{' '}
          Pages marked <span className="perm-warn perm-warn-inline">!</span> will open, but the database still only lets the roles it was set up for read or change that data
          ({unsupported.slice(0, 4).map(u => `${u.role.label}: ${u.module.label}`).join(', ')}{unsupported.length > 4 ? ` and ${unsupported.length - 4} more` : ''}).
          Inquiries is the exception: its database access follows this table. The others need their row level security policies updated before the role can use them.
        </div>
      )}

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
