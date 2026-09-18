// Shared password-reset token logic used by both request-password-reset
// (self-service) and manage-users' reset_password action (admin-triggered),
// so both paths generate/send/verify tokens identically.

import { renderTemplate, sendViaResend } from './resend.ts'

const TOKEN_TTL_MINUTES = 30

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(input: string) {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return bytesToHex(new Uint8Array(digest))
}

function generateRawToken() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return bytesToHex(bytes)
}

// Creates a token for the given user, invalidating any previous unused
// tokens for them first, and emails it via the password_reset template.
// adminClient must be a service-role client (bypasses RLS on purpose —
// password_reset_tokens has no anon/authenticated policies at all).
export async function issuePasswordReset(adminClient: any, { userId, email, fullName, redirectOrigin }: {
  userId: string
  email: string
  fullName?: string
  redirectOrigin: string
}) {
  await adminClient.from('password_reset_tokens').delete().eq('user_id', userId).is('used_at', null)

  const rawToken = generateRawToken()
  const tokenHash = await sha256Hex(rawToken)
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000).toISOString()

  const { error: insertError } = await adminClient.from('password_reset_tokens').insert({
    user_id: userId,
    token_hash: tokenHash,
    expires_at: expiresAt,
  })
  if (insertError) throw new Error(insertError.message)

  const { data: template } = await adminClient
    .from('email_templates')
    .select('*')
    .eq('template_key', 'password_reset')
    .maybeSingle()

  if (!template || !template.is_active) {
    // Template missing/disabled — token still exists so a resend can work
    // once it's active, but we can't deliver anything right now.
    return { sent: false, reason: 'password_reset template is missing or inactive' }
  }

  const resetLink = `${redirectOrigin}/reset-password?token=${rawToken}`
  const vars = { full_name: fullName || '', email, reset_link: resetLink, expires_in: `${TOKEN_TTL_MINUTES} minutes` }

  await sendViaResend([email], renderTemplate(template.subject, vars), renderTemplate(template.body_html, vars))
  return { sent: true }
}

export async function consumePasswordReset(adminClient: any, { token, password }: { token: string; password: string }) {
  const tokenHash = await sha256Hex(token)

  const { data: row, error } = await adminClient
    .from('password_reset_tokens')
    .select('*')
    .eq('token_hash', tokenHash)
    .is('used_at', null)
    .maybeSingle()

  if (error || !row) throw new Error('Invalid or expired reset link.')
  if (new Date(row.expires_at).getTime() < Date.now()) throw new Error('Invalid or expired reset link.')

  const { error: updateError } = await adminClient.auth.admin.updateUserById(row.user_id, { password })
  if (updateError) throw new Error(updateError.message)

  await adminClient.from('password_reset_tokens').update({ used_at: new Date().toISOString() }).eq('id', row.id)
}
