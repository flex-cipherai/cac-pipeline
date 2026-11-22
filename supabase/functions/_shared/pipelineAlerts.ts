// Rules for the sales pipeline's 48-hour alert. No Deno APIs: runs in Node tests too.
//
// An active lead is "stale" when nothing has been logged with it (call, e-meeting, physical meeting,
// email, WhatsApp) for STALE_AFTER_HOURS, counted from the last interaction or, if there has been none,
// from when the lead arrived. Each quiet spell alerts the admins once: stale_alerted_at is stamped, and
// only an alert older than the latest interaction allows a new one.
//
// Must match STALE_AFTER_HOURS and isStale() in src/lib/pipeline.js, which draw the flag on the board.

export const STALE_AFTER_HOURS = 48
const HOUR = 3_600_000

export interface PipelineLead {
  id: string
  full_name: string
  company_name: string | null
  stage: string
  entry_point: string
  source_channel: string
  owner_id: string | null
  created_at: string
  last_interaction_at: string | null
  stale_alerted_at: string | null
}

export function quietSince(lead: Pick<PipelineLead, 'created_at' | 'last_interaction_at'>): Date {
  return new Date(lead.last_interaction_at || lead.created_at)
}

export function isStale(lead: PipelineLead, now: Date): boolean {
  return lead.stage === 'active' && now.getTime() - quietSince(lead).getTime() >= STALE_AFTER_HOURS * HOUR
}

// Stale and not yet alerted for this quiet spell.
export function needsAlert(lead: PipelineLead, now: Date): boolean {
  if (!isStale(lead, now)) return false
  if (!lead.stale_alerted_at) return true
  return new Date(lead.stale_alerted_at).getTime() < quietSince(lead).getTime()
}

export function hoursQuiet(lead: PipelineLead, now: Date): number {
  return Math.floor((now.getTime() - quietSince(lead).getTime()) / HOUR)
}

export function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

function quietText(lead: PipelineLead, now: Date): string {
  const h = hoursQuiet(lead, now)
  const span = h >= 72 ? `${Math.floor(h / 24)} days` : `${h} hours`
  return lead.last_interaction_at ? `No interaction for ${span}` : `Never contacted · arrived ${span} ago`
}

export function itemsHtml(leads: PipelineLead[], now: Date, appBase: string, owners: Record<string, string> = {}): string {
  return leads.map(l => {
    const who = l.company_name ? `${escapeHtml(l.full_name)} · ${escapeHtml(l.company_name)}` : escapeHtml(l.full_name)
    const owner = l.owner_id && owners[l.owner_id] ? ` · owner ${escapeHtml(owners[l.owner_id])}` : ' · no owner'
    const link = `${appBase}/pipeline?lead=${l.id}`
    return `<div style="padding: 12px 0; border-bottom: 1px solid #EAE9E9;">
  <a href="${escapeHtml(link)}" style="font-size: 14px; font-weight: 700; color: #201E1D; text-decoration: none;">${who}</a>
  <div style="font-size: 13px; color: #EC3013; margin-top: 2px;">${escapeHtml(quietText(l, now))}</div>
  <div style="font-size: 12px; color: #888; margin-top: 2px;">${escapeHtml(l.entry_point === 'scoper' ? 'From the scoper' : l.entry_point === 'custom_build_form' ? 'Custom build form' : 'Added by staff')}${owner}</div>
</div>`
  }).join('')
}

export function summaryText(leads: PipelineLead[]): string {
  const names = leads.slice(0, 3).map(l => l.company_name || l.full_name).join(', ')
  return leads.length > 3 ? `${names} and ${leads.length - 3} more` : names
}
