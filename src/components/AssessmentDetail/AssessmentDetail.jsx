import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { shortDateTime } from '../../lib/inquiries'
import { ctaLabel, kes, money, progressNote, scoreTone, statusLabel } from '../../lib/gapAssessments'
import '../LeadDetail/LeadDetail.css'
import '../InquiryDetail/InquiryDetail.css'
import './AssessmentDetail.css'

const TABS = [
  { key: 'report', label: 'Report' },
  { key: 'chat', label: 'Conversation' },
  { key: 'details', label: 'Details' },
]

// currency is the visitor's report currency; the internal working is always KES.
function Money({ value, currency }) {
  return <>{money(value, currency)}</>
}

function ReportView({ report, internal }) {
  const internalById = new Map((internal?.gaps || []).map(g => [g.id, g]))
  const r = report.roi
  const invest = internal?.investment_kes || 0

  return (
    <div className="ga-report">
      <div className="ga-readiness">
        <span className={`ga-score ga-score-${scoreTone(report.readiness.score)} ga-score-lg`}>{report.readiness.score}</span>
        <div>
          <strong>{report.readiness.label} readiness</strong>
          <p>{report.readiness.summary}</p>
        </div>
      </div>

      {report.company.summary && <p className="ga-company-summary">{report.company.summary}</p>}
      {report.company.staff_estimate && <p className="ga-meta">About {report.company.staff_estimate} staff{report.company.sector ? ` · ${report.company.sector}` : ''}</p>}

      <h3 className="ga-h">Projected return</h3>
      {r.quantified_gaps ? (
        <div className="ga-roi-grid">
          <div><span>Value per year</span><strong><Money value={r.annual_low} currency={r.currency} /> to <Money value={r.annual_high} currency={r.currency} /></strong><small>Most likely <Money value={r.annual_expected} currency={r.currency} /></small></div>
          <div><span>Time recovered</span><strong>{r.hours_per_week_recovered} h / week</strong><small>{r.quantified_gaps} gap{r.quantified_gaps === 1 ? '' : 's'} counted</small></div>
          <div><span>First-year ROI</span><strong>{r.roi_pct_low}% to {r.roi_pct_high}%</strong><small>Payback {r.payback_months_best} to {r.payback_months_worst} months</small></div>
        </div>
      ) : (
        <p className="ga-meta">The answers did not give enough figures to estimate a return.</p>
      )}

      <div className="ga-internal">
        <span className="ga-internal-tag">Sales view, not shown to the visitor</span>
        {invest > 0
          ? <p>Our estimate to deliver everything counted above: <strong><Money value={invest} /></strong>. The ROI figures above are measured against this. The visitor was never shown it, nor any priority or per-opportunity cost.{r.currency && r.currency !== 'KES' ? ` The visitor chose ${r.currency}; the working and this estimate are in KES.` : ''}</p>
          : <p>Nothing was quantified, so there is no investment estimate.</p>}
      </div>

      <h3 className="ga-h">Gaps found ({report.gaps.length})</h3>
      {report.gaps.length === 0 && <p className="ga-meta">No specific gaps were identified from the conversation.</p>}
      {report.gaps.map(g => {
        const w = internalById.get(g.id)
        return (
          <div key={g.id} className="ga-gap">
            <div className="ga-gap-top">
              <span className="ga-area">{g.area_label}</span>
              <span className="ga-type">{g.solution_label}</span>
            </div>
            <h4>{g.title}</h4>
            <p>{g.finding}</p>
            {g.evidence && <p className="ga-evidence">They said: {g.evidence}</p>}
            {g.impact && <p><strong>Impact.</strong> {g.impact}</p>}
            {g.opportunity && <p><strong>Opportunity.</strong> {g.opportunity}</p>}
            <div className="ga-gap-roi">
              {g.roi.quantified
                ? <span><strong><Money value={g.roi.annual_low} currency={r.currency} /> to <Money value={g.roi.annual_high} currency={r.currency} /></strong> a year · {g.roi.hours_per_week_recovered} h/week back · {g.confidence} confidence</span>
                : <span>Not enough figures to put a value on this.</span>}
            </div>
            {w && (
              <div className="ga-internal ga-internal-gap">
                <span className="ga-internal-tag">Working</span>
                <p>
                  {w.people} {w.people === 1 ? 'person' : 'people'} × {w.hours_per_person_per_week} h/week at {kes(w.hourly_cost_kes)}/h, {Math.round(w.effectiveness * 100)}% removable by {g.solution_label.toLowerCase()}
                  {w.value_per_month_kes > 0 ? `; ${kes(w.value_per_month_kes)}/month revenue at stake` : ''}
                  {w.investment_kes > 0 ? `. Est. to deliver ${kes(w.investment_kes)}` : ''}{w.scaled ? ' (scaled down to the size ceiling)' : ''}.
                </p>
                {g.basis && <p className="ga-basis">Basis: {g.basis}</p>}
                {w.value_basis && <p className="ga-basis">Revenue basis: {w.value_basis}</p>}
              </div>
            )}
          </div>
        )
      })}

      <h3 className="ga-h">By area</h3>
      <div className="ga-areas">
        {report.areas.map(a => (
          <div key={a.key} className="ga-area-row">
            <div className="ga-area-head"><span>{a.label}</span><span className="ga-area-score">{a.score == null ? 'n/a' : `${a.score}/5`}</span></div>
            {a.score != null && <div className="ga-bar"><span style={{ width: `${a.score * 20}%` }} /></div>}
            <p>{a.finding}</p>
          </div>
        ))}
      </div>

      {report.strengths.length > 0 && (
        <>
          <h3 className="ga-h">Already working</h3>
          <ul className="ga-list">{report.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </>
      )}
    </div>
  )
}

export default function AssessmentDetail({ id, isAdmin, onClose, onDeleted }) {
  const [row, setRow] = useState(null)
  const [messages, setMessages] = useState([])
  const [tab, setTab] = useState('report')
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    let live = true
    setRow(null)
    setError('')
    ;(async () => {
      const [a, m] = await Promise.all([
        supabase.from('gap_assessments').select('*').eq('id', id).maybeSingle(),
        supabase.from('gap_assessment_messages').select('role, content, seq').eq('assessment_id', id).order('seq'),
      ])
      if (!live) return
      if (a.error || !a.data) { setError(a.error?.message || 'This assessment no longer exists.'); return }
      setRow(a.data)
      setMessages(m.data || [])
      setTab(a.data.report ? 'report' : 'chat')
    })()
    return () => { live = false }
  }, [id])

  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  async function handleDelete() {
    setDeleting(true)
    const { error: err } = await supabase.from('gap_assessments').delete().eq('id', id)
    setDeleting(false)
    if (err) return setError(err.message || 'Could not delete.')
    onDeleted(id)
  }

  return (
    <>
      <div className="lead-detail-overlay" onClick={onClose} />
      <div className="lead-detail-drawer ga-drawer" role="dialog" aria-modal="true" aria-label="Automation scoper">
        <div className="lead-detail-header">
          <div className="lead-detail-header-top">
            <button className="lead-detail-close" onClick={onClose} aria-label="Close">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M14 6L6 14M6 6l8 8" /></svg>
            </button>
          </div>
          {row ? (
            <>
              <div className="lead-detail-identity">
                <div className="lead-detail-avatar">{row.company_name?.charAt(0).toUpperCase()}</div>
                <div>
                  <h2 className="lead-detail-name">{row.company_name}</h2>
                  <p className="lead-detail-company">{row.full_name}</p>
                </div>
              </div>
              <div className="lead-detail-meta-row">
                <span className={`inq-status ${row.status === 'report_ready' ? 'inq-status-converted' : 'inq-status-contacted'}`}>{statusLabel(row.status)}</span>
                {row.pdf_downloaded_at && <span className="ga-chip">PDF downloaded</span>}
                {row.cta_clicked_at && <span className="ga-chip ga-chip-hot">Asked for more: {ctaLabel(row.cta_kind)}</span>}
              </div>
              <div className="lead-detail-contact-actions">
                <a href={`mailto:${row.email}`} className="lead-detail-contact-btn" title={`Email ${row.email}`}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><rect x="1" y="3" width="12" height="8" rx="1.5" /><path d="M1 4.5l6 4 6-4" /></svg>
                  Email
                </a>
                <a href={row.website_url} target="_blank" rel="noopener noreferrer" className="lead-detail-contact-btn" title={row.website_url}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><circle cx="7" cy="7" r="5.5" /><path d="M1.5 7h11M7 1.5c1.5 1.6 2.2 3.4 2.2 5.5S8.5 10.9 7 12.5C5.5 10.9 4.8 9.1 4.8 7S5.5 3.1 7 1.5z" /></svg>
                  Website
                </a>
                {row.inquiry_id && <Link to="/inquiries" className="lead-detail-contact-btn">Inquiries</Link>}
              </div>
            </>
          ) : (
            <p className="ga-loading">{error || 'Loading…'}</p>
          )}
        </div>

        {row && (
          <>
            <div className="lead-detail-tabs">
              {TABS.map(t => (
                <button key={t.key} className={`lead-detail-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
                  {t.label}{t.key === 'chat' && messages.length ? ` (${messages.length})` : ''}
                </button>
              ))}
            </div>

            <div className="lead-detail-body">
              {error && <p className="form-error inq-detail-error">{error}</p>}

              {tab === 'report' && (
                row.report
                  ? <ReportView report={row.report} internal={row.report_internal} />
                  : <p className="ga-meta">No report yet. This visitor stopped after {progressNote(row)}. Their conversation is in the next tab.</p>
              )}

              {tab === 'chat' && (
                <div className="ga-chat">
                  {messages.map(m => (
                    <div key={m.seq} className={`ga-msg ga-msg-${m.role}`}>
                      <span className="ga-msg-who">{m.role === 'user' ? row.full_name.split(' ')[0] : 'Assistant'}</span>
                      <p>{m.content}</p>
                    </div>
                  ))}
                  {messages.length === 0 && <p className="ga-meta">No messages.</p>}
                </div>
              )}

              {tab === 'details' && (
                <div className="lead-detail-section">
                  <div className="lead-detail-field-group">
                    {[
                      ['Email', row.email],
                      ['Website', row.website_url],
                      ['Started', shortDateTime(row.created_at)],
                      ['Report ready', row.report_generated_at ? shortDateTime(row.report_generated_at) : 'Not yet'],
                      ['Last activity', shortDateTime(row.last_activity_at)],
                      ['Replies', `${row.user_turns}`],
                      ['Areas covered', `${(row.areas_covered || []).length}`],
                      ['PDF downloaded', row.pdf_downloaded_at ? shortDateTime(row.pdf_downloaded_at) : 'No'],
                      ['Asked for more', row.cta_clicked_at ? `${ctaLabel(row.cta_kind)}, ${shortDateTime(row.cta_clicked_at)}` : 'No'],
                      ['Source', [row.utm_source, row.utm_medium, row.utm_campaign].filter(Boolean).join(' / ') || row.referrer || 'Direct'],
                      ['AI model', row.model || '—'],
                      ['AI usage', `${row.llm_calls} calls, ${(row.input_tokens + row.output_tokens).toLocaleString('en-US')} tokens`],
                    ].map(([label, value]) => (
                      <div key={label} className="lead-detail-field">
                        <span className="lead-detail-field-label">{label}</span>
                        <span className="lead-detail-field-value ga-wrap">{value}</span>
                      </div>
                    ))}
                  </div>
                  {row.website_summary && (
                    <div className="inq-message">
                      <span className="lead-detail-field-label">What the AI read on their website</span>
                      <p>{row.website_summary}</p>
                    </div>
                  )}
                  {isAdmin && (
                    confirmDelete
                      ? (
                        <div className="ga-confirm">
                          <span>Delete this assessment and its conversation? The inquiry stays.</span>
                          <button className="btn btn-danger btn-sm" onClick={handleDelete} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete'}</button>
                          <button className="btn btn-secondary btn-sm" onClick={() => setConfirmDelete(false)}>Keep</button>
                        </div>
                      )
                      : <button className="inq-delete-link" onClick={() => setConfirmDelete(true)}>Delete this assessment</button>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  )
}
