// Pure logic for the website-lead Edge Function: validation, the readable message that lands on the
// inquiry, follow-up dates and the emails. No Deno or network APIs here, so it can be tested under Node.
//
// The five forms on sdfmgroup.com (assessment, guide, industry, custom, contact) post here.
// Keep the option values in step with the <select>s in cac-website/build output (js/forms.js, the HTML forms).

export type Offer = 'assessment' | 'guide' | 'industry' | 'custom' | 'contact'

export const OFFER_LABELS: Record<Offer, string> = {
  assessment: 'AI gap assessment',
  guide: 'Free guide',
  industry: 'Industry software',
  custom: 'Custom build',
  contact: 'Contact form',
}

export const STAFF_LABELS: Record<string, string> = {
  '1-5': '1 to 5', '6-15': '6 to 15', '16-50': '16 to 50', '51-100': '51 to 100', '100+': 'More than 100',
}

export const SECTOR_LABELS: Record<string, string> = {
  security: 'Security services', manufacturing: 'Manufacturing', retail: 'Retail and wholesale',
  construction: 'Construction and real estate', education: 'Education', finance: 'Finance and professional services',
  logistics: 'Logistics and transport', hospitality: 'Hospitality', agriculture: 'Agriculture',
  healthcare: 'Healthcare', other: 'Other',
}

const INTEREST_LABELS: Record<string, Record<string, string>> = {
  industry: { demo: 'Request a demo', suggest: 'Suggest an industry' },
  contact: {
    assessment: 'AI gap assessment', guide: 'Free guide', industry: 'Industry software',
    custom: 'Custom build', other: 'Something else',
  },
}

const PAST_WORK_LABELS: Record<string, string> = {
  assessment: 'Completed an assessment with SDFM', guide: 'Downloaded the guide', neither: 'Neither',
}

// What the free-text box asked on each form (shown above the visitor's words in the inquiry).
const MESSAGE_PROMPTS: Record<Offer, string> = {
  assessment: 'Which part of your business would you most like us to look at?',
  guide: '',
  industry: 'Which industry, and what must a system handle?',
  custom: 'Which process or workflow do you want built around?',
  contact: 'Message',
}

// Which fields each form requires (the rest are optional or absent).
const REQUIRED: Record<Offer, string[]> = {
  assessment: ['phone', 'business_name', 'staff_band', 'sector'],
  guide: ['phone', 'business_name', 'staff_band'],
  industry: ['phone', 'business_name', 'staff_band', 'sector', 'interest'],
  custom: ['phone', 'business_name', 'staff_band', 'sector', 'message'],
  contact: ['interest', 'message'],
}

// Healthcare cannot be sold on these (those systems need DHA certification); the guide and contact form still go through.
const HEALTHCARE_BLOCKED: Offer[] = ['assessment', 'industry', 'custom']
export const HEALTHCARE_MESSAGE = "We don't currently build for healthcare, because those systems need DHA certification"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function cleanText(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max) : ''
}

// Kenyan numbers: +254 7xx / 254 7xx / 07xx / 01xx, saved as +254...
export function normalisePhone(raw: unknown): string | null {
  const s = String(raw ?? '').replace(/[\s\-().]/g, '')
  const m = /^(?:\+254|254|0)([17]\d{8})$/.exec(s)
  return m ? '+254' + m[1] : null
}

export interface LeadValue {
  offer: Offer
  full_name: string
  email: string
  phone: string | null
  business_name: string | null
  staff_band: string | null
  sector: string | null
  interest: string | null
  message: string | null
  past_work: string | null
  page_url: string | null
  referrer: string | null
  source: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_term: string | null
}

export function validateLead(body: Record<string, unknown>) {
  const errors: Record<string, string> = {}
  const offer = body.offer as Offer
  if (!(offer in OFFER_LABELS)) return { errors: { offer: 'Unknown form.' }, value: null as LeadValue | null }
  const need = (f: string) => REQUIRED[offer].includes(f)

  const full_name = cleanText(body.full_name, 120)
  const email = cleanText(body.email, 254).toLowerCase()
  const rawPhone = cleanText(body.phone, 30)
  const business_name = cleanText(body.business_name, 160)
  const staff_band = cleanText(body.staff_band, 10)
  const sector = cleanText(body.sector, 20)
  const interest = cleanText(body.interest, 20)
  const message = cleanText(body.message, 2000)
  const past_work = cleanText(body.past_work, 20)

  if (full_name.length < 2) errors.full_name = 'Enter your full name.'
  if (!EMAIL_RE.test(email)) errors.email = 'Enter an email like name@company.co.ke'

  const phone = normalisePhone(rawPhone)
  if (rawPhone ? !phone : need('phone')) errors.phone = 'Enter a Kenyan number like 0712 345 678 or +254 712 345 678'
  if (need('business_name') && !business_name) errors.business_name = 'Enter your business name.'

  if (staff_band ? !(staff_band in STAFF_LABELS) : need('staff_band')) errors.staff_band = 'Choose how many staff you have.'
  if (sector ? !(sector in SECTOR_LABELS) : need('sector')) errors.sector = 'Choose your sector.'
  if (sector === 'healthcare' && HEALTHCARE_BLOCKED.includes(offer)) errors.sector = HEALTHCARE_MESSAGE

  const interests = INTEREST_LABELS[offer]
  if (interests ? (interest ? !(interest in interests) : need('interest')) : false) errors.interest = 'Choose what you are interested in.'
  if (need('message') && !message) errors.message = offer === 'custom' ? 'Tell us which process or workflow you want built.' : 'Write us a short message.'
  if (past_work && !(past_work in PAST_WORK_LABELS)) errors.past_work = 'Choose one of the options.'
  if (body.consent !== true) errors.consent = 'Tick the box so we can reply to you.'

  const opt = (s: string, max: number) => cleanText(s, max) || null
  return {
    errors,
    value: {
      offer, full_name, email, phone, business_name: business_name || null,
      staff_band: staff_band || null, sector: sector || null, interest: interest || null,
      message: message || null, past_work: past_work || null,
      page_url: opt(body.page_url as string, 300), referrer: opt(body.referrer as string, 300),
      source: opt(body.source as string, 60),
      utm_source: opt(body.utm_source as string, 120), utm_medium: opt(body.utm_medium as string, 120),
      utm_campaign: opt(body.utm_campaign as string, 120), utm_term: opt(body.utm_term as string, 120),
    } as LeadValue,
  }
}

// Same source naming the booking page used, so the CRM's source reports stay comparable.
export function detectSource(v: Pick<LeadValue, 'source' | 'utm_source' | 'referrer'>): string {
  if (v.source) return v.source.slice(0, 60)
  if (v.utm_source) {
    const map: Record<string, string> = { linkedin: 'LinkedIn', facebook: 'Facebook', twitter: 'Twitter', instagram: 'Instagram', google: 'Google', email: 'Email', whatsapp: 'WhatsApp' }
    return (map[v.utm_source.toLowerCase()] || v.utm_source).slice(0, 60)
  }
  const ref = (v.referrer || '').toLowerCase()
  if (ref.includes('linkedin.com')) return 'LinkedIn'
  if (ref.includes('facebook.com') || ref.includes('fb.com')) return 'Facebook'
  if (ref.includes('twitter.com') || ref.includes('x.com') || ref.includes('t.co/')) return 'Twitter'
  if (ref.includes('instagram.com')) return 'Instagram'
  if (ref.includes('google.')) return 'Google'
  return 'Website'
}

export function sourceDetail(v: LeadValue): string {
  const parts = [`${OFFER_LABELS[v.offer]} form`, detectSource(v)]
  if (v.utm_campaign) parts.push(`campaign: ${v.utm_campaign}`)
  return parts.join(' · ').slice(0, 200)
}

// Everything the CRM has no column for yet, as readable lines at the top of the inquiry's message.
export function buildMessage(v: LeadValue): string {
  const lines = [`Offer: ${OFFER_LABELS[v.offer]}`]
  if (v.interest) lines.push(`Interest: ${INTEREST_LABELS[v.offer]?.[v.interest] ?? v.interest}`)
  if (v.staff_band) lines.push(`Number of staff: ${STAFF_LABELS[v.staff_band]}`)
  if (v.sector) lines.push(`Sector: ${SECTOR_LABELS[v.sector]}`)
  if (v.past_work) lines.push(`Past work with SDFM: ${PAST_WORK_LABELS[v.past_work]}`)
  if (v.page_url) lines.push(`Page: ${v.page_url}`)
  let out = lines.join('\n')
  if (v.message) {
    const prompt = MESSAGE_PROMPTS[v.offer]
    out += `\n\n${prompt ? prompt + '\n' : ''}${v.message}`
  }
  return out
}

// Guide downloads are followed up a week later with the next offer; everything else needs a reply now.
export function followUpDate(offer: Offer, today: Date): string {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  if (offer === 'guide') d.setUTCDate(d.getUTCDate() + 7)
  return d.toISOString().slice(0, 10)
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const GUIDE_PATH = '/downloads/ai-gap-assessment-guide.pdf'

// Flip to true once the PDF is uploaded to /downloads/. Until then the guide email says it is not ready
// instead of linking to a file that does not exist (the website's thank-you page does the same).
export const GUIDE_READY = false

const VISITOR_COPY: Record<Offer, { subject: string; lead: string; next: string }> = {
  assessment: {
    subject: 'We have your AI gap assessment request',
    lead: 'Thanks for requesting an AI gap assessment.',
    next: "We'll reply by email and WhatsApp to confirm the scope and the fee for your business size. No payment has been taken.",
  },
  guide: {
    subject: 'Your free AI gap assessment guide',
    lead: 'Thanks for asking for the free AI gap assessment guide.',
    next: GUIDE_READY
      ? 'Download it with the button below. When you have worked through it, an assessment does the same job for you, with a roadmap and costs.'
      : 'The guide is not ready yet. Please check back in a few days and download it from sdfmgroup.com/diy-guide.',
  },
  industry: {
    subject: 'We have your industry software request',
    lead: 'Thanks for your interest in our industry software.',
    next: "We'll contact you about the demo or your industry.",
  },
  custom: {
    subject: 'We have your scoping call request',
    lead: 'Thanks for asking about a custom build.',
    next: "We'll contact you to agree a time for the scoping call.",
  },
  contact: {
    subject: 'We have your message',
    lead: 'Thanks for getting in touch.',
    next: "We'll reply by email or WhatsApp.",
  },
}

export function visitorEmail(v: LeadValue, siteUrl: string) {
  const c = VISITOR_COPY[v.offer]
  const first = escapeHtml(v.full_name.split(/\s+/)[0])
  const button = v.offer === 'guide' && GUIDE_READY
    ? `<p style="margin:24px 0"><a href="${siteUrl}${GUIDE_PATH}" style="display:inline-block;background:#D82A10;color:#ffffff;font-weight:700;text-decoration:none;padding:14px 24px;border-radius:12px">Download the guide (PDF)</a></p>`
    : ''
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#141211;line-height:1.6">
<p>Hi ${first},</p>
<p>${c.lead}</p>
<p>${c.next}</p>
${button}<p>If you need us sooner, WhatsApp or call <a href="https://wa.me/254757230579" style="color:#C9260C;font-weight:700">+254 757 230 579</a>.</p>
<p style="margin-top:28px">SDFM Group Limited<br>Nairobi, Kenya</p>
</div>`
  return { subject: c.subject, html }
}

export function teamEmail(v: LeadValue, source: string) {
  const row = (k: string, val: string | null) => val ? `<tr><td style="padding:4px 14px 4px 0;color:#6A645E">${k}</td><td style="padding:4px 0"><strong>${escapeHtml(val)}</strong></td></tr>` : ''
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;color:#141211;line-height:1.5">
<p style="font-size:16px"><strong>New website enquiry: ${escapeHtml(OFFER_LABELS[v.offer])}</strong></p>
<table style="border-collapse:collapse;font-size:14px">
${row('Name', v.full_name)}${row('Email', v.email)}${row('Phone', v.phone)}${row('Business', v.business_name)}${row('Source', source)}
</table>
<pre style="font-family:Arial,Helvetica,sans-serif;font-size:14px;white-space:pre-wrap;background:#FAF8F5;padding:14px;border-radius:8px">${escapeHtml(buildMessage(v))}</pre>
<p style="font-size:13px;color:#6A645E">Find it under Inquiries in the CRM. Reply within the hour if you can.</p>
</div>`
  return { subject: `New website enquiry: ${OFFER_LABELS[v.offer]} (${v.full_name})`, html }
}
