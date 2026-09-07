import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import './Notifications.css'

// Default templates seeded into DB
const DEFAULT_TEMPLATES = [
  {
    template_key: 'call_confirmed',
    name: 'Discovery Call Confirmed',
    recipient_type: 'client',
    description: 'Sent to qualified leads (Hot and Warm) when they book a discovery call.',
    subject: 'Your Discovery Call is Confirmed — {{scheduled_day}} at {{scheduled_time}}',
    body_html: `<div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #201E1D;">
  <div style="padding: 32px 0 24px; text-align: center;">
    <span style="font-size: 22px; font-weight: 700; color: #EC3013;">CIPHER AI</span>
    <span style="font-size: 12px; display: block; letter-spacing: 0.15em; color: #201E1D;">CONSULTANTS</span>
  </div>
  <div style="background: #F3F2F2; border-radius: 10px; padding: 32px; margin-bottom: 24px;">
    <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 8px;">Discovery Call Confirmed</h1>
    <p style="font-size: 14px; color: #666; margin: 0 0 24px;">Hi {{full_name}}, your call has been scheduled.</p>
    <div style="background: white; border-radius: 8px; padding: 20px; border-left: 4px solid #EC3013;">
      <p style="margin: 0; font-size: 14px;"><strong>Date:</strong> {{scheduled_day}}</p>
      <p style="margin: 8px 0 0; font-size: 14px;"><strong>Time:</strong> {{scheduled_time}}</p>
    </div>
    <p style="font-size: 14px; color: #666; margin: 24px 0 0; line-height: 1.6;">
      During this call, we'll discuss your business challenges and explore how AI solutions
      can help. No preparation is needed — just bring your questions.
    </p>
  </div>
  <p style="font-size: 12px; color: #999; text-align: center;">Cipher AI Consultants · Transforming Kenyan Businesses</p>
</div>`,
    available_variables: ['full_name', 'company_name', 'email', 'phone', 'scheduled_day', 'scheduled_time', 'classification', 'total_score'],
  },
  {
    template_key: 'cold_rejection',
    name: 'Thank You (Disqualified)',
    recipient_type: 'client',
    description: 'Sent to Cold leads after form submission. Polite and invites future reconnection.',
    subject: 'Thank You for Your Interest — Cipher AI Consultants',
    body_html: `<div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #201E1D;">
  <div style="padding: 32px 0 24px; text-align: center;">
    <span style="font-size: 22px; font-weight: 700; color: #EC3013;">CIPHER AI</span>
    <span style="font-size: 12px; display: block; letter-spacing: 0.15em; color: #201E1D;">CONSULTANTS</span>
  </div>
  <div style="background: #F3F2F2; border-radius: 10px; padding: 32px; margin-bottom: 24px;">
    <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 16px;">Thank You, {{full_name}}</h1>
    <p style="font-size: 14px; color: #666; line-height: 1.6; margin: 0 0 16px;">
      We appreciate you taking the time to tell us about your business.
    </p>
    <p style="font-size: 14px; color: #666; line-height: 1.6; margin: 0;">
      Based on the information you provided, our services may not be the right fit at this time.
      As your needs evolve, we'd welcome the chance to reconnect. You can book a discovery call
      anytime from our website.
    </p>
  </div>
  <p style="font-size: 12px; color: #999; text-align: center;">Cipher AI Consultants · Transforming Kenyan Businesses</p>
</div>`,
    available_variables: ['full_name', 'company_name', 'email'],
  },
  {
    template_key: 'questions_sent',
    name: 'Assessment Questions Sent',
    recipient_type: 'client',
    description: 'Sent when assessment questions are delivered to the lead.',
    subject: 'Your AI Gap Assessment Questions — Cipher AI Consultants',
    body_html: `<div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #201E1D;">
  <div style="padding: 32px 0 24px; text-align: center;">
    <span style="font-size: 22px; font-weight: 700; color: #EC3013;">CIPHER AI</span>
    <span style="font-size: 12px; display: block; letter-spacing: 0.15em; color: #201E1D;">CONSULTANTS</span>
  </div>
  <div style="background: #F3F2F2; border-radius: 10px; padding: 32px; margin-bottom: 24px;">
    <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 8px;">Assessment Questions Ready</h1>
    <p style="font-size: 14px; color: #666; line-height: 1.6; margin: 0 0 16px;">
      Hi {{full_name}}, following our discovery call, we've prepared a set of detailed questions
      to help us understand your business operations more deeply.
    </p>
    <p style="font-size: 14px; color: #666; line-height: 1.6; margin: 0;">
      Please complete and return these at your earliest convenience. Your responses will form the
      basis of your personalised AI Gap Assessment Report.
    </p>
  </div>
  <p style="font-size: 12px; color: #999; text-align: center;">Cipher AI Consultants · Transforming Kenyan Businesses</p>
</div>`,
    available_variables: ['full_name', 'company_name', 'email', 'current_stage'],
  },
  {
    template_key: 'report_ready',
    name: 'Gap Assessment Report Ready',
    recipient_type: 'client',
    description: 'Sent when the Gap Assessment Report has been completed and is ready for presentation.',
    subject: 'Your AI Gap Assessment Report is Ready — Cipher AI Consultants',
    body_html: `<div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #201E1D;">
  <div style="padding: 32px 0 24px; text-align: center;">
    <span style="font-size: 22px; font-weight: 700; color: #EC3013;">CIPHER AI</span>
    <span style="font-size: 12px; display: block; letter-spacing: 0.15em; color: #201E1D;">CONSULTANTS</span>
  </div>
  <div style="background: #F3F2F2; border-radius: 10px; padding: 32px; margin-bottom: 24px;">
    <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 8px;">Your Report is Ready</h1>
    <p style="font-size: 14px; color: #666; line-height: 1.6; margin: 0 0 16px;">
      Hi {{full_name}}, we've completed your personalised AI Gap Assessment Report for {{company_name}}.
    </p>
    <p style="font-size: 14px; color: #666; line-height: 1.6; margin: 0;">
      The report includes a detailed analysis of your current operations, identified opportunities
      for AI integration, and a recommended implementation roadmap. We'll be in touch to schedule
      a presentation walkthrough.
    </p>
  </div>
  <p style="font-size: 12px; color: #999; text-align: center;">Cipher AI Consultants · Transforming Kenyan Businesses</p>
</div>`,
    available_variables: ['full_name', 'company_name', 'email', 'current_stage'],
  },
  {
    template_key: 'contract_sent',
    name: 'Contract Sent',
    recipient_type: 'client',
    description: 'Sent when the project contract is prepared and delivered to the lead.',
    subject: 'Your Project Contract — Cipher AI Consultants',
    body_html: `<div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #201E1D;">
  <div style="padding: 32px 0 24px; text-align: center;">
    <span style="font-size: 22px; font-weight: 700; color: #EC3013;">CIPHER AI</span>
    <span style="font-size: 12px; display: block; letter-spacing: 0.15em; color: #201E1D;">CONSULTANTS</span>
  </div>
  <div style="background: #F3F2F2; border-radius: 10px; padding: 32px; margin-bottom: 24px;">
    <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 8px;">Your Contract is Ready</h1>
    <p style="font-size: 14px; color: #666; line-height: 1.6; margin: 0 0 16px;">
      Hi {{full_name}}, we've prepared the project contract for {{company_name}} based on
      the scope we discussed during the report presentation.
    </p>
    <p style="font-size: 14px; color: #666; line-height: 1.6; margin: 0;">
      Please review the attached contract at your convenience. If you have any questions or
      would like to discuss any terms, don't hesitate to reach out. We're excited to get started.
    </p>
  </div>
  <p style="font-size: 12px; color: #999; text-align: center;">Cipher AI Consultants · Transforming Kenyan Businesses</p>
</div>`,
    available_variables: ['full_name', 'company_name', 'email', 'current_stage'],
  },
  {
    template_key: 'new_lead_alert',
    name: 'New Lead Alert',
    recipient_type: 'team',
    description: 'Sent to the admin/team when a new lead submits the intake form.',
    subject: 'New {{classification}} Lead: {{full_name}} from {{company_name}} ({{total_score}}/21)',
    body_html: `<div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #201E1D;">
  <div style="padding: 32px 0 24px; text-align: center;">
    <span style="font-size: 22px; font-weight: 700; color: #EC3013;">CIPHER AI</span>
    <span style="font-size: 12px; display: block; letter-spacing: 0.15em; color: #201E1D;">CONSULTANTS</span>
  </div>
  <div style="background: #F3F2F2; border-radius: 10px; padding: 32px; margin-bottom: 24px;">
    <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 16px;">New Lead Submitted</h1>
    <div style="background: white; border-radius: 8px; padding: 20px; margin-bottom: 16px;">
      <p style="margin: 0 0 8px; font-size: 14px;"><strong>Name:</strong> {{full_name}}</p>
      <p style="margin: 0 0 8px; font-size: 14px;"><strong>Company:</strong> {{company_name}}</p>
      <p style="margin: 0 0 8px; font-size: 14px;"><strong>Classification:</strong> {{classification}}</p>
      <p style="margin: 0 0 8px; font-size: 14px;"><strong>Score:</strong> {{total_score}}/21</p>
      <p style="margin: 0; font-size: 14px;"><strong>Call:</strong> {{scheduled_day}} at {{scheduled_time}}</p>
    </div>
    <p style="font-size: 13px; color: #666;">View full details in the Pipeline Dashboard.</p>
  </div>
</div>`,
    available_variables: ['full_name', 'company_name', 'email', 'phone', 'classification', 'total_score', 'scheduled_day', 'scheduled_time', 'source'],
  },
  {
    template_key: 'stage_changed',
    name: 'Stage Change Notification',
    recipient_type: 'team',
    description: 'Sent to the team when a lead moves to a new pipeline stage.',
    subject: 'Lead Update: {{full_name}} moved to {{current_stage}}',
    body_html: `<div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #201E1D;">
  <div style="padding: 32px 0 24px; text-align: center;">
    <span style="font-size: 22px; font-weight: 700; color: #EC3013;">CIPHER AI</span>
    <span style="font-size: 12px; display: block; letter-spacing: 0.15em; color: #201E1D;">CONSULTANTS</span>
  </div>
  <div style="background: #F3F2F2; border-radius: 10px; padding: 32px; margin-bottom: 24px;">
    <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 16px;">Pipeline Update</h1>
    <div style="background: white; border-radius: 8px; padding: 20px;">
      <p style="margin: 0 0 8px; font-size: 14px;"><strong>Lead:</strong> {{full_name}} ({{company_name}})</p>
      <p style="margin: 0 0 8px; font-size: 14px;"><strong>Previous Stage:</strong> {{previous_stage}}</p>
      <p style="margin: 0; font-size: 14px;"><strong>New Stage:</strong> {{current_stage}}</p>
    </div>
  </div>
</div>`,
    available_variables: ['full_name', 'company_name', 'email', 'classification', 'total_score', 'current_stage', 'previous_stage'],
  },
  {
    template_key: 'lead_lost',
    name: 'Lead Marked as Lost',
    recipient_type: 'team',
    description: 'Sent to the team when a lead is marked as lost from the pipeline.',
    subject: 'Lead Lost: {{full_name}} from {{company_name}}',
    body_html: `<div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #201E1D;">
  <div style="padding: 32px 0 24px; text-align: center;">
    <span style="font-size: 22px; font-weight: 700; color: #EC3013;">CIPHER AI</span>
    <span style="font-size: 12px; display: block; letter-spacing: 0.15em; color: #201E1D;">CONSULTANTS</span>
  </div>
  <div style="background: #F3F2F2; border-radius: 10px; padding: 32px; margin-bottom: 24px;">
    <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 16px;">Lead Lost</h1>
    <div style="background: white; border-radius: 8px; padding: 20px;">
      <p style="margin: 0 0 8px; font-size: 14px;"><strong>Lead:</strong> {{full_name}} ({{company_name}})</p>
      <p style="margin: 0 0 8px; font-size: 14px;"><strong>Classification:</strong> {{classification}}</p>
      <p style="margin: 0 0 8px; font-size: 14px;"><strong>Last Stage:</strong> {{current_stage}}</p>
      <p style="margin: 0; font-size: 14px;"><strong>Reason:</strong> {{lost_reason}}</p>
    </div>
  </div>
</div>`,
    available_variables: ['full_name', 'company_name', 'email', 'classification', 'total_score', 'current_stage', 'lost_reason'],
  },
]

const VARIABLE_LABELS = {
  full_name: 'Lead Name',
  company_name: 'Company',
  email: 'Email',
  phone: 'Phone',
  classification: 'Classification',
  total_score: 'Score',
  scheduled_day: 'Call Day',
  scheduled_time: 'Call Time',
  current_stage: 'Current Stage',
  previous_stage: 'Previous Stage',
  lost_reason: 'Lost Reason',
  source: 'Lead Source',
}

export default function Notifications() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'

  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [editSubject, setEditSubject] = useState('')
  const [editBody, setEditBody] = useState('')
  const [editActive, setEditActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [toast, setToast] = useState({ show: false, type: '', text: '' })
  const [filter, setFilter] = useState('all')
  const bodyRef = useRef(null)

  useEffect(() => { fetchTemplates() }, [])

  useEffect(() => {
    if (toast.show) {
      const timer = setTimeout(() => setToast({ show: false, type: '', text: '' }), 4000)
      return () => clearTimeout(timer)
    }
  }, [toast.show])

  function showToast(type, text) { setToast({ show: true, type, text }) }

  async function fetchTemplates() {
    const { data, error } = await supabase
      .from('email_templates')
      .select('*')
      .order('recipient_type')
      .order('template_key')

    if (data && data.length > 0) {
      setTemplates(data)
    } else {
      // Seed defaults if table is empty
      setTemplates(DEFAULT_TEMPLATES.map((t, i) => ({ ...t, id: `default-${i}`, is_active: true })))
    }
    setLoading(false)
  }

  function selectTemplate(tmpl) {
    setSelected(tmpl)
    setEditSubject(tmpl.subject)
    setEditBody(tmpl.body_html)
    setEditActive(tmpl.is_active)
    setShowPreview(false)
  }

  function insertVariable(varName) {
    const tag = `{{${varName}}}`
    if (bodyRef.current) {
      const ta = bodyRef.current
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const text = editBody
      setEditBody(text.substring(0, start) + tag + text.substring(end))
      setTimeout(() => {
        ta.focus()
        ta.selectionStart = ta.selectionEnd = start + tag.length
      }, 0)
    } else {
      setEditBody(prev => prev + tag)
    }
  }

  async function handleSave() {
    if (!selected) return
    setSaving(true)
    try {
      if (selected.id?.startsWith('default-')) {
        // First save — insert into DB
        const { data, error } = await supabase.from('email_templates').insert({
          template_key: selected.template_key,
          name: selected.name,
          recipient_type: selected.recipient_type,
          description: selected.description,
          subject: editSubject,
          body_html: editBody,
          is_active: editActive,
          available_variables: selected.available_variables,
        }).select().single()
        if (error) throw error
        setTemplates(prev => prev.map(t => t.template_key === selected.template_key ? data : t))
        setSelected(data)
      } else {
        // Update existing
        const { data, error } = await supabase.from('email_templates')
          .update({ subject: editSubject, body_html: editBody, is_active: editActive })
          .eq('id', selected.id)
          .select().single()
        if (error) throw error
        setTemplates(prev => prev.map(t => t.id === selected.id ? data : t))
        setSelected(data)
      }
      showToast('success', 'Template saved')
    } catch (err) {
      showToast('error', err.message || 'Failed to save template')
    } finally {
      setSaving(false)
    }
  }

  function getPreviewHtml() {
    const sampleData = {
      full_name: 'Jane Wanjiku',
      company_name: 'Savanna Logistics Ltd',
      email: 'jane@savannalogistics.co.ke',
      phone: '+254 712 345 678',
      classification: 'Hot',
      total_score: '18',
      scheduled_day: 'Tuesday',
      scheduled_time: '10:00',
      current_stage: 'Report Prep',
      previous_stage: 'Responses In',
      lost_reason: 'Budget constraints — cannot commit financially',
      source: 'LinkedIn',
    }
    let html = editBody
    Object.entries(sampleData).forEach(([key, val]) => {
      html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), val)
    })
    return html
  }

  const filtered = filter === 'all' ? templates : templates.filter(t => t.recipient_type === filter)
  const clientTemplates = filtered.filter(t => t.recipient_type === 'client')
  const teamTemplates = filtered.filter(t => t.recipient_type === 'team')

  if (loading) {
    return (
      <div>
        <div className="page-header"><h1 className="page-title">Notifications</h1></div>
        <div className="skeleton skeleton-card" style={{ height: 300 }} />
      </div>
    )
  }

  return (
    <div className="notifications-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Notifications</h1>
          <p className="page-subtitle">{templates.length} email templates</p>
        </div>
      </div>

      <div className="notif-layout">
        {/* ── Template List ── */}
        <div className={`notif-list-panel ${selected ? 'has-selection' : ''}`}>
          {/* Filter pills */}
          <div className="notif-filters">
            {[
              { key: 'all', label: 'All' },
              { key: 'client', label: 'Client' },
              { key: 'team', label: 'Team' },
            ].map(f => (
              <button
                key={f.key}
                className={`notif-filter-pill ${filter === f.key ? 'active' : ''}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Client templates */}
          {clientTemplates.length > 0 && (
            <div className="notif-group">
              <div className="notif-group-label">Client notifications</div>
              {clientTemplates.map(tmpl => (
                <button
                  key={tmpl.template_key}
                  className={`notif-card ${selected?.template_key === tmpl.template_key ? 'active' : ''} ${!tmpl.is_active ? 'inactive' : ''}`}
                  onClick={() => selectTemplate(tmpl)}
                >
                  <div className="notif-card-top">
                    <span className="notif-card-name">{tmpl.name}</span>
                    <span className={`notif-card-status ${tmpl.is_active ? 'on' : 'off'}`}>
                      {tmpl.is_active ? 'Active' : 'Off'}
                    </span>
                  </div>
                  <p className="notif-card-desc">{tmpl.description}</p>
                </button>
              ))}
            </div>
          )}

          {/* Team templates */}
          {teamTemplates.length > 0 && (
            <div className="notif-group">
              <div className="notif-group-label">Team notifications</div>
              {teamTemplates.map(tmpl => (
                <button
                  key={tmpl.template_key}
                  className={`notif-card ${selected?.template_key === tmpl.template_key ? 'active' : ''} ${!tmpl.is_active ? 'inactive' : ''}`}
                  onClick={() => selectTemplate(tmpl)}
                >
                  <div className="notif-card-top">
                    <span className="notif-card-name">{tmpl.name}</span>
                    <span className={`notif-card-status ${tmpl.is_active ? 'on' : 'off'}`}>
                      {tmpl.is_active ? 'Active' : 'Off'}
                    </span>
                  </div>
                  <p className="notif-card-desc">{tmpl.description}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Editor Panel ── */}
        <div className={`notif-editor-panel ${selected ? 'open' : ''}`}>
          {!selected ? (
            <div className="notif-editor-empty">
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <rect x="4" y="8" width="32" height="24" rx="3" />
                <path d="M4 14l16 10 16-10" />
              </svg>
              <p>Select a template to edit</p>
            </div>
          ) : (
            <>
              {/* Mobile back button */}
              <button className="notif-editor-back" onClick={() => setSelected(null)}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M10 3L5 8l5 5" /></svg>
                Back to templates
              </button>

              <div className="notif-editor-header">
                <div>
                  <h2 className="notif-editor-title">{selected.name}</h2>
                  <span className={`notif-type-badge ${selected.recipient_type}`}>
                    {selected.recipient_type === 'client' ? 'Client' : 'Team'}
                  </span>
                </div>
                <label className="notif-toggle-wrap">
                  <span className="notif-toggle-label">{editActive ? 'Active' : 'Inactive'}</span>
                  <div className={`notif-toggle ${editActive ? 'on' : ''}`} onClick={() => setEditActive(!editActive)}>
                    <div className="notif-toggle-knob" />
                  </div>
                </label>
              </div>

              <p className="notif-editor-desc">{selected.description}</p>

              {/* Subject */}
              <div className="notif-field">
                <label className="notif-field-label">Subject line</label>
                <input
                  className="notif-field-input"
                  value={editSubject}
                  onChange={e => setEditSubject(e.target.value)}
                  placeholder="Email subject..."
                />
              </div>

              {/* Variables */}
              <div className="notif-variables">
                <span className="notif-variables-label">Insert variable:</span>
                <div className="notif-variable-chips">
                  {(selected.available_variables || []).map(v => (
                    <button key={v} className="notif-variable-chip" onClick={() => insertVariable(v)} title={`Insert {{${v}}}`}>
                      {VARIABLE_LABELS[v] || v}
                    </button>
                  ))}
                </div>
              </div>

              {/* Body / Preview toggle */}
              <div className="notif-body-tabs">
                <button className={`notif-body-tab ${!showPreview ? 'active' : ''}`} onClick={() => setShowPreview(false)}>Edit HTML</button>
                <button className={`notif-body-tab ${showPreview ? 'active' : ''}`} onClick={() => setShowPreview(true)}>Preview</button>
              </div>

              {showPreview ? (
                <div className="notif-preview-frame">
                  <div dangerouslySetInnerHTML={{ __html: getPreviewHtml() }} />
                </div>
              ) : (
                <textarea
                  ref={bodyRef}
                  className="notif-body-editor"
                  value={editBody}
                  onChange={e => setEditBody(e.target.value)}
                  rows={16}
                  spellCheck={false}
                />
              )}

              {/* Save */}
              <div className="notif-editor-actions">
                <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving...' : 'Save Template'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Toast */}
      {toast.show && (
        <div className={`toast toast-${toast.type}`}>
          {toast.type === 'success' ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 8.5l3 3 5-6" /></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="8" cy="8" r="6" /><path d="M8 5v3.5M8 10.5v.5" /></svg>
          )}
          {toast.text}
        </div>
      )}
    </div>
  )
}
