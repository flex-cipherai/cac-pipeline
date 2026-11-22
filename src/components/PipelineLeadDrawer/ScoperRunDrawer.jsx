import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthContext'
import { SOURCE_BY_KEY, classifySource, timeAgo, money } from '../../lib/pipeline'
import './PipelineLeadDrawer.css'

// Stage 1: an anonymous scoper run. Read-only, with a way to move it to stage 2 when the run already holds
// contact details (sessions from before the scoper stopped asking for them up front).
export default function ScoperRunDrawer({ run, canEdit, onClose, onPromoted, onToast }) {
  const { profile } = useAuth()
  const [busy, setBusy] = useState(false)
  const src = classifySource(run)
  const ready = run.status === 'report_ready'
  const roi = run.roi

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function promote() {
    if (busy) return
    setBusy(true)
    const { data, error } = await supabase.from('pipeline_leads').insert({
      service_line: 'custom_build', stage: 'active', entry_point: 'scoper',
      full_name: run.full_name, email: run.email, phone: run.phone, company_name: run.company_name, website_url: run.website_url,
      source_channel: src, source_detail: 'Automation scoper (moved by staff)', assessment_id: run.id,
      estimated_value: roi?.quantified_gaps ? Math.round(roi.annual_expected) : null, currency: roi?.currency || 'KES',
      utm_source: run.utm_source, utm_medium: run.utm_medium, referrer: run.referrer, page_url: run.page_url,
      owner_id: profile?.id, created_by: profile?.id,
    }).select('*').single()
    if (error) { setBusy(false); onToast({ type: 'error', text: error.message }); return }
    await supabase.from('gap_assessments').update({ pipeline_lead_id: data.id }).eq('id', run.id)
    setBusy(false)
    onPromoted(data)
  }

  const s = SOURCE_BY_KEY[src]
  return (
    <>
      <div className="lead-detail-overlay" onClick={onClose} aria-hidden="true" />
      <aside className="pld pld-narrow" role="dialog" aria-modal="true" aria-label={`Scoper run: ${run.company_name}`}>
        <header className="pld-head">
          <div className="pld-identity">
            <span className="pld-avatar pld-avatar-run" aria-hidden="true">1</span>
            <div>
              <h2 className="pld-name">{run.company_name}</h2>
              <p className="pld-sub">{run.full_name ? `${run.full_name}${run.email ? ` · ${run.email}` : ''}` : 'Anonymous: no contact details left'}</p>
            </div>
          </div>
          <button type="button" className="lead-detail-close" onClick={onClose} aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M14 6L6 14M6 6l8 8" /></svg>
          </button>
        </header>
        <div className="pld-meta">
          <span className="pld-stage pld-stage-scoper">{ready ? 'Report ready' : 'In progress'}</span>
          <span className="pld-meta-item">{s?.label}</span>
          <span className="pld-meta-item">Started {timeAgo(run.created_at)}</span>
        </div>
        <div className="pld-body">
          <div className="pld-stats">
            <div><span>Readiness</span><strong>{run.readiness?.score != null ? `${run.readiness.score}/100` : '—'}</strong></div>
            <div><span>Projected value</span><strong>{roi?.quantified_gaps ? `${money(roi.annual_low, roi.currency)} – ${money(roi.annual_high, roi.currency)}` : '—'}</strong></div>
            <div><span>Replies</span><strong>{run.user_turns || 0}</strong></div>
            <div><span>PDF</span><strong>{run.pdf_downloaded_at ? 'Downloaded' : 'No'}</strong></div>
          </div>
          <p className="pld-muted">
            {run.full_name
              ? 'This run already holds contact details (it started before the scoper stopped asking for them). You can move it to the active leads.'
              : 'Scoper runs are anonymous. When the visitor leaves their details at the end of the report, they move to Active leads by themselves and the team is emailed.'}
          </p>
          <div className="pld-contact">
            <Link className="pld-contact-btn" to={`/assessments?id=${run.id}`}>Open the full report and conversation</Link>
          </div>
        </div>
        {canEdit && run.full_name && (run.email || run.phone) && (
          <footer className="pld-foot">
            <button type="button" className="btn btn-primary" onClick={promote} disabled={busy}>{busy ? 'Moving…' : 'Move to active leads'}</button>
          </footer>
        )}
      </aside>
    </>
  )
}
