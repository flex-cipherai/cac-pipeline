// Shared Resend send helper + template rendering for edge functions.

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const SENDER_EMAIL = Deno.env.get('SENDER_EMAIL') || 'notifications@sdfmgroup.com'
const SENDER_NAME = 'SDFM Group Limited'

export function requireResendKey() {
  if (!RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is not configured. Set it via: supabase secrets set RESEND_API_KEY=re_xxxxx')
  }
}

export function renderTemplate(str: string, vars: Record<string, unknown>) {
  return str.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    const value = vars[key]
    return value === null || value === undefined ? '' : String(value)
  })
}

export async function sendViaResend(to: string[], subject: string, html: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: `${SENDER_NAME} <${SENDER_EMAIL}>`,
      to,
      subject,
      html,
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.message || 'Resend API error')
  return data
}
