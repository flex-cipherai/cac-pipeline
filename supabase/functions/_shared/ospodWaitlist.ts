// Pure rules for the Ospod waitlist: what a signup may contain, and the alert email the team gets.
// No Deno or network imports here, so it runs (and is tested) anywhere.
//
// The allowed answers below must match the chips on the landing pages (ospod/src/components/Shared.jsx).
// The database does not constrain them (so a wording change is a change here, not a migration); this file
// is where an answer the page did not offer is refused.

export const FOUNDING_CAP = 500

export const VARIANTS = ['indie', 'studios'] as const
export const ROLES = ['I host a podcast', 'I run a studio or agency', 'I work on a brand podcast', 'Something else']
export const SHOWS = ['1', '2 to 4', '5 to 10', '11+']
export const EPISODES = ['1 to 4', '5 to 10', '11 to 30', '31+']
export const SPEND = ['I edit myself', 'Under $100', '$100 to $500', '$500 to $2,000', '$2,000+']

// The page waits this long before it can send; a person needs a few seconds to answer four questions.
export const MIN_FILL_MS = 2500

export interface SignupValue {
  email: string
  variant: 'indie' | 'studios'
  role: string
  shows: string
  episodes: string
  spend: string
  page_path: string
  referrer: string
  utm_source: string
  utm_medium: string
  utm_campaign: string
  utm_content: string
  utm_term: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Free text from the browser: no control characters, trimmed, capped.
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return ''
  // deno-lint-ignore no-control-regex
  return v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)
}

export function validateSignup(body: unknown): { errors: Record<string, string>; value: SignupValue | null } {
  const errors: Record<string, string> = {}
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>

  const email = cleanText(b.email, 254)
  if (!EMAIL_RE.test(email)) errors.email = 'invalid'

  const pick = (key: string, allowed: string[]) => {
    const v = typeof b[key] === 'string' ? (b[key] as string).trim() : ''
    if (!allowed.includes(v)) errors[key] = 'invalid'
    return v
  }
  const role = pick('role', ROLES)
  const shows = pick('shows', SHOWS)
  const episodes = pick('episodes', EPISODES)
  const spend = pick('spend', SPEND)
  const variant = pick('variant', [...VARIANTS]) as SignupValue['variant']

  if (Object.keys(errors).length) return { errors, value: null }

  return {
    errors,
    value: {
      email, variant, role, shows, episodes, spend,
      page_path: cleanText(b.page_path, 200),
      referrer: cleanText(b.referrer, 500),
      utm_source: cleanText(b.utm_source, 120),
      utm_medium: cleanText(b.utm_medium, 120),
      utm_campaign: cleanText(b.utm_campaign, 120),
      utm_content: cleanText(b.utm_content, 120),
      utm_term: cleanText(b.utm_term, 120),
    },
  }
}

// A human trap for bots: anything in the hidden field, or sent faster than a person could answer.
export function looksLikeBot(body: unknown): boolean {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const filled = typeof b.website === 'string' && b.website.trim() !== ''
  const tooFast = typeof b.elapsed_ms === 'number' && b.elapsed_ms < MIN_FILL_MS
  return filled || tooFast
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export function pageLabel(variant: string): string {
  return variant === 'studios' ? 'Studios page (LinkedIn)' : 'Podcasters page (Instagram)'
}

// "instagram / paid · waitlist1 · ig_30", or "Direct or unknown" when there were no campaign tags.
export function sourceLabel(v: Pick<SignupValue, 'utm_source' | 'utm_medium' | 'utm_campaign' | 'utm_content' | 'referrer'>): string {
  const parts = [
    [v.utm_source, v.utm_medium].filter(Boolean).join(' / '),
    v.utm_campaign,
    v.utm_content,
  ].filter(Boolean)
  if (parts.length) return parts.join(' · ')
  return v.referrer ? `Referred by ${v.referrer}` : 'Direct or unknown'
}

export interface AlertInput {
  value: SignupValue
  memberNo: number
  founding: boolean
  claimed: number
  appUrl?: string
}

// The email the team gets on every new signup.
export function signupAlert({ value: v, memberNo, founding, claimed, appUrl }: AlertInput) {
  const row = (k: string, val: string) =>
    `<tr><td style="padding:4px 14px 4px 0;color:#6A645E;vertical-align:top">${k}</td><td style="padding:4px 0"><strong>${escapeHtml(val)}</strong></td></tr>`
  const link = appUrl ? `<p style="font-size:14px"><a href="${escapeHtml(appUrl.replace(/\/+$/, ''))}/ospod-waitlist">Open the Ospod waitlist in the CRM</a></p>` : ''
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;color:#141211;line-height:1.5">
<p style="font-size:16px"><strong>New Ospod signup #${memberNo}</strong>${founding ? '' : ' (after the Founding 500)'}</p>
<table style="border-collapse:collapse;font-size:14px">
${row('Email', v.email)}${row('Page', pageLabel(v.variant))}${row('Describes them', v.role)}${row('Shows', v.shows)}${row('Episodes a month', v.episodes)}${row('Spends on editing', v.spend)}${row('Source', sourceLabel(v))}
</table>
<p style="font-size:14px;color:#6A645E">${claimed} of ${FOUNDING_CAP} founding spots claimed.</p>
${link}
</div>`
  return {
    subject: `New Ospod signup #${memberNo}: ${v.role} (${v.variant === 'studios' ? 'studios page' : 'podcasters page'})`,
    html,
  }
}
