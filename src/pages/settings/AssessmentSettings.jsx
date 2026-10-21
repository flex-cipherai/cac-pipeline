import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { SettingsHeading } from './SettingsLayout'
import useToast from './useToast'
import { buildConfig, CONFIG_KEYS, DEFAULT_CONFIG, SETTING_KEYS } from '../../../supabase/functions/_shared/gapAssessment.ts'

// Each block saves on its own button, so changing the ROI maths cannot half-save the questions.

const ROI_FIELDS = [
  { key: 'hourly_cost_kes', label: 'Default hourly cost of staff time (KES)', hint: 'Used when the visitor did not mention pay. Fully loaded: salary plus statutory costs.', step: 50 },
  { key: 'working_weeks_per_year', label: 'Working weeks per year', hint: 'Turns weekly hours into yearly hours.', step: 1 },
  { key: 'max_hours_per_person_per_week', label: 'Most hours one person can spend on one gap, per week', hint: 'Caps a visitor who exaggerates.', step: 1 },
  { key: 'revenue_capture', label: 'Share of lost revenue we count as recoverable', hint: '0.3 means 30%. Applies to lost-sales figures the visitor gave.', step: 0.05 },
  { key: 'range_low', label: 'Low case multiplier', hint: 'The low end of the range shown is the likely value times this, times the confidence factor.', step: 0.05 },
  { key: 'range_high', label: 'High case multiplier', hint: 'The high end of the range is the likely value times this.', step: 0.05 },
  { key: 'min_investment_per_gap_kes', label: 'Smallest investment assumed per opportunity (KES)', hint: 'Internal only. Stops tiny gaps showing absurd ROI. Never shown to the visitor.', step: 5000 },
  { key: 'max_benefit_per_staff_kes', label: 'Largest total yearly benefit per employee (KES)', hint: 'Sanity ceiling. If the total goes above staff × this, every gap is scaled down together.', step: 50000 },
  { key: 'rounding_kes', label: 'Round figures to the nearest (KES)', hint: 'Estimates should not look more precise than they are.', step: 500 },
]

const MAP_FIELDS = [
  { key: 'effectiveness', label: 'Share of the time removed, by kind of fix', hint: '0.7 means the fix removes 70% of the time spent today.' },
  { key: 'investment_months_of_benefit', label: 'Typical cost, in months of the yearly benefit', hint: 'Internal only. Used to work out ROI and payback, which are shown; the cost itself is not.' },
  { key: 'confidence_factor', label: 'Low-case factor, by how sure the figures are', hint: 'Applied to the low end of the range only.' },
]

const TYPE_LABELS = DEFAULT_CONFIG.solution_types
const MAP_LABELS = { low: 'Rough guess', medium: 'Partly given', high: 'Given by the visitor' }

function slug(label, taken) {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'area'
  let key = /^[a-z]/.test(base) ? base : `a_${base}`
  let n = 2
  while (taken.has(key)) key = `${key.replace(/_\d+$/, '')}_${n++}`
  return key
}

function Section({ title, hint, children, onSave, onReset, saving, saveLabel = 'Save' }) {
  return (
    <div className="section-card" style={{ padding: 'var(--space-lg)', marginBottom: 'var(--space-lg)' }}>
      <h3 className="settings-disq-title" style={{ padding: 0, marginBottom: 4 }}>{title}</h3>
      {hint && <p className="form-hint" style={{ marginBottom: 'var(--space-md)' }}>{hint}</p>}
      {children}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-sm)', marginTop: 'var(--space-md)' }}>
        {onReset && <button className="btn btn-secondary btn-sm" onClick={onReset} disabled={saving}>Reset to defaults</button>}
        <button className="btn btn-primary btn-sm" onClick={onSave} disabled={saving}>{saving ? 'Saving…' : saveLabel}</button>
      </div>
    </div>
  )
}

export default function AssessmentSettings() {
  const { showToast, toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [settings, setSettings] = useState(DEFAULT_CONFIG.settings)
  const [instructions, setInstructions] = useState('')
  const [areas, setAreas] = useState(DEFAULT_CONFIG.areas)
  const [roi, setRoi] = useState(DEFAULT_CONFIG.roi)
  const [saving, setSaving] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    const { data } = await supabase.from('system_settings').select('key, value').in('key', CONFIG_KEYS)
    const cfg = buildConfig(data || [])
    setSettings(cfg.settings)
    setInstructions(cfg.instructions)
    setAreas(cfg.areas)
    setRoi(cfg.roi)
    setLoading(false)
  }

  async function save(name, key, value) {
    setSaving(name)
    const { error } = await supabase.from('system_settings').upsert({ key, value: typeof value === 'string' ? value : JSON.stringify(value) }, { onConflict: 'key' })
    setSaving('')
    if (error) return showToast('error', error.message || 'Could not save')
    showToast('success', 'Saved. New conversations use it straight away.')
  }

  const setS = (k, v) => setSettings(prev => ({ ...prev, [k]: v }))
  const setArea = (i, patch) => setAreas(prev => prev.map((a, j) => (j === i ? { ...a, ...patch } : a)))
  const moveArea = (i, d) => setAreas(prev => {
    const next = [...prev]
    const j = i + d
    if (j < 0 || j >= next.length) return prev
    ;[next[i], next[j]] = [next[j], next[i]]
    return next
  })
  const setRoiField = (k, v) => setRoi(prev => ({ ...prev, [k]: v }))
  const setRoiMap = (map, k, v) => setRoi(prev => ({ ...prev, [map]: { ...prev[map], [k]: v } }))

  function saveAreas() {
    if (areas.length < 3) return showToast('error', 'Keep at least three business areas.')
    if (areas.some(a => !a.label.trim())) return showToast('error', 'Every area needs a name.')
    save('areas', SETTING_KEYS.areas, areas.map(a => ({ ...a, label: a.label.trim(), focus: a.focus.trim() })))
  }

  if (loading) {
    return (
      <div>
        <SettingsHeading title="Automation scoper" />
        <div className="skeleton skeleton-card" style={{ height: 240 }} />
      </div>
    )
  }

  const num = (v) => (v === '' ? '' : Number(v))

  return (
    <div>
      <SettingsHeading
        title="Automation scoper"
        hint="Controls the free Automation scoper on sdfmgroup.com/ai-gap-check (the automation scoper): what the AI asks, how the return is worked out, and the limits that protect the free AI quota. Changes apply to the next conversation."
      />

      <Section title="Tool and limits" hint="The Gemini API key is not stored here. It is a Supabase secret named GEMINI_API_KEY, so the browser can never see it." saving={saving === 'settings'}
        onSave={() => save('settings', SETTING_KEYS.settings, settings)} onReset={() => setSettings(DEFAULT_CONFIG.settings)}>
        <label className="checkbox-label" style={{ marginBottom: 'var(--space-md)' }}>
          <input type="checkbox" checked={settings.enabled} onChange={e => setS('enabled', e.target.checked)} />
          Tool is open to visitors (turn off to pause it; the page tells people to contact us instead)
        </label>
        <label className="checkbox-label" style={{ marginBottom: 'var(--space-md)' }}>
          <input type="checkbox" checked={settings.block_free_email} onChange={e => setS('block_free_email', e.target.checked)} />
          Require a work email (reject Gmail, Yahoo, Outlook and similar). Temporary addresses are always rejected.
        </label>
        <div className="profile-edit-grid">
          <div className="form-group">
            <label className="form-label">AI model</label>
            <input className="form-input" value={settings.model} onChange={e => setS('model', e.target.value.trim())} />
            <span className="form-hint">Check the model is on your free tier in Google AI Studio.</span>
          </div>
          <div className="form-group">
            <label className="form-label">Fallback model</label>
            <input className="form-input" value={settings.fallback_model} onChange={e => setS('fallback_model', e.target.value.trim())} />
            <span className="form-hint">Used when the first is rate limited. Its own free quota, so it doubles the headroom.</span>
          </div>
          <div className="form-group">
            <label className="form-label">Assessments per day, all visitors</label>
            <input className="form-input" type="number" min="1" value={settings.daily_session_cap} onChange={e => setS('daily_session_cap', num(e.target.value))} />
            <span className="form-hint">Stops a rush from using up the free quota. Past this, visitors are asked to come back tomorrow.</span>
          </div>
          <div className="form-group">
            <label className="form-label">Replies before the report is offered</label>
            <input className="form-input" type="number" min="3" max="40" value={settings.min_user_turns} onChange={e => setS('min_user_turns', num(e.target.value))} />
          </div>
          <div className="form-group">
            <label className="form-label">Most replies in one assessment</label>
            <input className="form-input" type="number" min="5" max="60" value={settings.max_user_turns} onChange={e => setS('max_user_turns', num(e.target.value))} />
          </div>
          <div className="form-group">
            <label className="form-label">Areas to cover before the report is offered</label>
            <input className="form-input" type="number" min="1" max="12" value={settings.min_areas_covered} onChange={e => setS('min_areas_covered', num(e.target.value))} />
          </div>
        </div>
      </Section>

      <Section title="What the AI covers" hint="The business areas it interviews about, in the order they appear in the report. The text under each name tells the AI what to dig into. Reports already created keep their own wording."
        saving={saving === 'areas'} onSave={saveAreas} onReset={() => setAreas(DEFAULT_CONFIG.areas)}>
        {areas.map((a, i) => (
          <div key={a.key} style={{ borderTop: i ? '1px solid var(--border)' : 'none', padding: 'var(--space-md) 0' }}>
            <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}>
              <input className="form-input" value={a.label} onChange={e => setArea(i, { label: e.target.value })} aria-label="Area name" style={{ flex: 1 }} />
              <button className="btn btn-secondary btn-sm" onClick={() => moveArea(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
              <button className="btn btn-secondary btn-sm" onClick={() => moveArea(i, 1)} disabled={i === areas.length - 1} aria-label="Move down">↓</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setAreas(prev => prev.filter((_, j) => j !== i))} disabled={areas.length <= 3} aria-label="Remove area">Remove</button>
            </div>
            <textarea className="form-input" rows={2} value={a.focus} onChange={e => setArea(i, { focus: e.target.value })} aria-label="What to ask about" style={{ marginTop: 'var(--space-sm)' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              <label className="checkbox-label"><input type="checkbox" checked={a.optional} onChange={e => setArea(i, { optional: e.target.checked })} /> Can be skipped when it does not apply</label>
              <span className="form-hint">id: {a.key}</span>
            </div>
          </div>
        ))}
        {areas.length < 12 && (
          <button className="btn btn-secondary btn-sm" onClick={() => setAreas(prev => [...prev, { key: slug('New area', new Set(prev.map(x => x.key))), label: 'New area', focus: '', optional: false }])}>+ Add an area</button>
        )}
      </Section>

      <Section title="Extra guidance for the AI" hint="Anything about SDFM the AI should know or a tone to keep: sectors you serve, things to avoid saying, questions you always want asked. Plain sentences."
        saving={saving === 'instructions'} onSave={() => save('instructions', SETTING_KEYS.instructions, instructions.trim())} onReset={() => setInstructions('')}>
        <textarea className="form-input" rows={5} maxLength={3000} value={instructions} onChange={e => setInstructions(e.target.value)} placeholder="For example: We work mostly with security firms, schools and distributors. Always ask how invoices reach customers." />
      </Section>

      <Section title="How the return is worked out" hint="Projected value = people × hours saved × how much of it the fix removes × weeks × hourly cost, plus any lost revenue the visitor quantified. ROI compares that with a typical cost. Visitors see the value, the ROI and the payback, never the cost, a priority or a per-opportunity price."
        saving={saving === 'roi'} onSave={() => save('roi', SETTING_KEYS.roi, roi)} onReset={() => setRoi(DEFAULT_CONFIG.roi)}>
        <div className="profile-edit-grid">
          {ROI_FIELDS.map(f => (
            <div className="form-group" key={f.key}>
              <label className="form-label">{f.label}</label>
              <input className="form-input" type="number" step={f.step} value={roi[f.key]} onChange={e => setRoiField(f.key, num(e.target.value))} />
              <span className="form-hint">{f.hint}</span>
            </div>
          ))}
        </div>
        {MAP_FIELDS.map(m => (
          <div key={m.key} style={{ marginTop: 'var(--space-md)' }}>
            <label className="form-label">{m.label}</label>
            <span className="form-hint" style={{ display: 'block', marginBottom: 6 }}>{m.hint}</span>
            <div className="profile-edit-grid">
              {Object.keys(DEFAULT_CONFIG.roi[m.key]).map(k => (
                <div className="form-group" key={k}>
                  <label className="form-label" style={{ fontWeight: 500 }}>{TYPE_LABELS[k] || MAP_LABELS[k] || k}</label>
                  <input className="form-input" type="number" step="0.05" value={roi[m.key][k]} onChange={e => setRoiMap(m.key, k, num(e.target.value))} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </Section>

      {toast}
    </div>
  )
}
