// Helpers for the Automation Scoper module: formatting and the numbers on the list page.
// The assessment rules themselves (areas, ROI maths, defaults) are shared with the Edge Function from
// supabase/functions/_shared/gapAssessment.ts, so the CRM and the tool can never disagree about them.

export { isMissingTable } from './inquiries'

export function kes(n) {
  return 'KES ' + Math.round(Number(n) || 0).toLocaleString('en-US')
}

// The report's money is in the currency the visitor chose (roi.currency); older reports are KES.
export function money(n, currency = 'KES') {
  return `${currency || 'KES'} ` + Math.round(Number(n) || 0).toLocaleString('en-US')
}

// KES 1.2M / KES 340K, for table cells.
export function kesShort(n, currency = 'KES') {
  const v = Number(n) || 0
  const c = currency || 'KES'
  if (v >= 1e6) return `${c} ${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`
  if (v >= 1e3) return `${c} ${Math.round(v / 1e3)}K`
  return `${c} ${Math.round(v)}`
}

export function valueRange(roi) {
  if (!roi || !roi.quantified_gaps) return null
  return `${kesShort(roi.annual_low, roi.currency)} to ${kesShort(roi.annual_high, roi.currency)}`
}

export function statusLabel(status) {
  return status === 'report_ready' ? 'Report ready' : 'In progress'
}

// What staff need to know about a session that never finished: how far it got.
export function progressNote(row, totalAreas = 8) {
  const covered = (row.areas_covered || []).length
  return `${row.user_turns} ${row.user_turns === 1 ? 'reply' : 'replies'}, ${covered} of ${totalAreas} areas`
}

export function scoreTone(score) {
  if (score == null) return 'none'
  return score >= 60 ? 'good' : score >= 35 ? 'mid' : 'low'
}

export function summarise(rows) {
  const done = rows.filter(r => r.status === 'report_ready')
  const scores = done.map(r => r.readiness?.score).filter(s => typeof s === 'number')
  // Reports can be in different currencies, so add up the KES equivalent the function stores alongside.
  const value = done.reduce((sum, r) => sum + (Number(r.roi?.annual_expected_kes ?? r.roi?.annual_expected) || 0), 0)
  return {
    started: rows.length,
    completed: done.length,
    completionRate: rows.length ? Math.round((done.length / rows.length) * 100) : 0,
    avgReadiness: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    value,
    pdfs: done.filter(r => r.pdf_downloaded_at).length,
    asked: done.filter(r => r.cta_clicked_at).length,
  }
}

export function ctaLabel(kind) {
  return { assessment: 'Full assessment page', contact: 'Contact page', whatsapp: 'WhatsApp' }[kind] || 'Follow-up link'
}
