// Where a prospect came from, in the sales pipeline's terms. No Deno APIs: runs in Node tests too.
//
// Must match classifySource() in src/lib/pipeline.js (the board uses it for rows saved before this field
// existed). Order matters: a paid click carries utm tags, an organic one usually only a referrer.

export const SOURCE_CHANNELS = ['direct', 'linkedin_organic', 'linkedin_paid', 'meta_organic', 'meta_paid', 'email', 'other'] as const
export type SourceChannel = typeof SOURCE_CHANNELS[number]

export const SOURCE_LABELS: Record<SourceChannel, string> = {
  direct: 'Direct',
  linkedin_organic: 'LinkedIn (organic)',
  linkedin_paid: 'LinkedIn (paid)',
  meta_organic: 'Meta (organic)',
  meta_paid: 'Meta (paid)',
  email: 'Email',
  other: 'Other',
}

export interface SourceHints {
  utm_source?: string | null
  utm_medium?: string | null
  referrer?: string | null
  page_url?: string | null
  heard_from?: string | null
}

const PAID = /^(cpc|ppc|cpm|cpv|paid|paid[_-]?social|paidsocial|social[_-]?paid|ads?|display|sponsored)$/
const LINKEDIN = /linkedin|lnkd/
const META = /facebook|instagram|^fb$|^ig$|^meta$|messenger|threads/
const EMAIL = /e-?mail|newsletter|mailchimp|resend|brevo|sendgrid|klaviyo/

function host(url: string | null | undefined): string {
  if (!url) return ''
  try { return new URL(url).hostname.toLowerCase() } catch { return '' }
}

function param(url: string | null | undefined, key: string): string {
  if (!url) return ''
  try { return new URL(url).searchParams.get(key) || '' } catch { return '' }
}

export function classifySource(h: SourceHints, ownHosts: string[] = ['sdfmgroup.com']): SourceChannel {
  const src = String(h.utm_source || param(h.page_url, 'utm_source') || '').trim().toLowerCase()
  const med = String(h.utm_medium || param(h.page_url, 'utm_medium') || '').trim().toLowerCase()
  const ref = host(h.referrer)
  const paid = PAID.test(med) || !!param(h.page_url, 'li_fat_id') || (!!param(h.page_url, 'fbclid') && !!src)

  if (src || med) {
    if (LINKEDIN.test(src)) return paid ? 'linkedin_paid' : 'linkedin_organic'
    if (META.test(src)) return paid ? 'meta_paid' : 'meta_organic'
    if (EMAIL.test(src) || EMAIL.test(med)) return 'email'
  }
  if (ref) {
    if (/(^|\.)linkedin\.com$|(^|\.)lnkd\.in$/.test(ref)) return 'linkedin_organic'
    if (/(^|\.)(facebook|instagram|threads)\.(com|net)$|(^|\.)fb\.me$|(^|\.)m\.me$/.test(ref)) return 'meta_organic'
    if (/mail\.|outlook\.|mail\.google\.com$/.test(ref)) return 'email'
    if (!ownHosts.some(o => ref === o || ref.endsWith('.' + o))) return 'other'
  }
  if (src || med) return 'other'
  // Nothing in the visit: fall back to what the visitor told us, else it was typed in or bookmarked.
  if (h.heard_from === 'linkedin') return 'linkedin_organic'
  if (h.heard_from === 'instagram') return 'meta_organic'
  if (h.heard_from === 'other') return 'other'
  return 'direct'
}
