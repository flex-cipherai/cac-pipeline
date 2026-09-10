// ─── Email Notification Service ───
// Infrastructure for email notifications via Supabase Edge Functions + Resend
// Currently returns templates; actual sending activates once Resend is configured
//
// To activate:
// 1. Register your domain and configure Resend
// 2. Deploy the send-email Edge Function (supabase/functions/send-email)
// 3. Set RESEND_API_KEY in Supabase secrets
// 4. Uncomment the fetch calls in sendNotification()

import { supabase } from './supabase'

// ── Email Templates ──

export function qualifiedLeadConfirmation({ fullName, scheduledDay, scheduledTime }) {
  return {
    subject: `Your Discovery Call is Confirmed — ${scheduledDay} at ${scheduledTime}`,
    html: `
      <div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #201E1D;">
        <div style="padding: 32px 0 24px; text-align: center;">
          <span style="font-size: 22px; font-weight: 700; color: #EC3013;">SDFM GROUP</span>
          <span style="font-size: 12px; display: block; letter-spacing: 0.15em; color: #201E1D;">LIMITED</span>
        </div>
        <div style="background: #F3F2F2; border-radius: 10px; padding: 32px; margin-bottom: 24px;">
          <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 8px;">Discovery Call Confirmed</h1>
          <p style="font-size: 14px; color: #666; margin: 0 0 24px;">Hi ${fullName}, your call has been scheduled.</p>
          <div style="background: white; border-radius: 8px; padding: 20px; border-left: 4px solid #EC3013;">
            <p style="margin: 0; font-size: 14px;"><strong>Date:</strong> ${scheduledDay}</p>
            <p style="margin: 8px 0 0; font-size: 14px;"><strong>Time:</strong> ${scheduledTime}</p>
          </div>
          <p style="font-size: 14px; color: #666; margin: 24px 0 0; line-height: 1.6;">
            During this call, we'll discuss your business challenges and explore how AI solutions
            can help. No preparation is needed — just bring your questions.
          </p>
        </div>
        <p style="font-size: 12px; color: #999; text-align: center;">
          SDFM Group Limited · Transforming Kenyan Businesses
        </p>
      </div>
    `,
  }
}

export function coldLeadThankYou({ fullName }) {
  return {
    subject: 'Thank You for Your Interest — SDFM Group Limited',
    html: `
      <div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #201E1D;">
        <div style="padding: 32px 0 24px; text-align: center;">
          <span style="font-size: 22px; font-weight: 700; color: #EC3013;">SDFM GROUP</span>
          <span style="font-size: 12px; display: block; letter-spacing: 0.15em; color: #201E1D;">LIMITED</span>
        </div>
        <div style="background: #F3F2F2; border-radius: 10px; padding: 32px; margin-bottom: 24px;">
          <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 16px;">Thank You, ${fullName}</h1>
          <p style="font-size: 14px; color: #666; line-height: 1.6; margin: 0 0 16px;">
            We appreciate you taking the time to tell us about your business.
          </p>
          <p style="font-size: 14px; color: #666; line-height: 1.6; margin: 0;">
            Based on the information you provided, our services may not be the right fit at this time.
            As your needs evolve, we'd welcome the chance to reconnect. You can book a discovery call
            anytime from our website.
          </p>
        </div>
        <p style="font-size: 12px; color: #999; text-align: center;">
          SDFM Group Limited · Transforming Kenyan Businesses
        </p>
      </div>
    `,
  }
}

export function adminNewLeadAlert({ fullName, companyName, classification, totalScore, scheduledDay, scheduledTime }) {
  const classColors = { hot: '#EC3013', warm: '#d97706', cold: '#6b7280' }
  return {
    subject: `New ${classification.toUpperCase()} Lead: ${fullName} from ${companyName} (${totalScore}/21)`,
    html: `
      <div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #201E1D;">
        <div style="padding: 32px 0 24px; text-align: center;">
          <span style="font-size: 22px; font-weight: 700; color: #EC3013;">SDFM GROUP</span>
          <span style="font-size: 12px; display: block; letter-spacing: 0.15em; color: #201E1D;">LIMITED</span>
        </div>
        <div style="background: #F3F2F2; border-radius: 10px; padding: 32px; margin-bottom: 24px;">
          <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 16px;">New Lead Submitted</h1>
          <div style="background: white; border-radius: 8px; padding: 20px; margin-bottom: 16px;">
            <p style="margin: 0 0 8px; font-size: 14px;"><strong>Name:</strong> ${fullName}</p>
            <p style="margin: 0 0 8px; font-size: 14px;"><strong>Company:</strong> ${companyName}</p>
            <p style="margin: 0 0 8px; font-size: 14px;">
              <strong>Classification:</strong>
              <span style="color: ${classColors[classification] || '#666'}; font-weight: 700;">${classification.toUpperCase()}</span>
            </p>
            <p style="margin: 0 0 8px; font-size: 14px;"><strong>Score:</strong> ${totalScore}/21</p>
            ${scheduledDay ? `<p style="margin: 0; font-size: 14px;"><strong>Call:</strong> ${scheduledDay} at ${scheduledTime}</p>` : ''}
          </div>
          <p style="font-size: 13px; color: #666;">
            View full details in the <a href="${typeof window !== 'undefined' ? window.location.origin : ''}/pipeline" style="color: #EC3013; font-weight: 600;">Pipeline Dashboard</a>.
          </p>
        </div>
      </div>
    `,
  }
}

// ── Send Function ──
// Currently logs to console. Uncomment the Edge Function call once Resend is configured.

export async function sendNotification({ to, template }) {
  const { subject, html } = template

  console.log(`[Email Notification] To: ${to} | Subject: ${subject}`)
  console.log('[Email Notification] Email sending is not yet active. Configure Resend and deploy the send-email Edge Function to enable.')

  // ── Uncomment below once the send-email Edge Function is deployed ──
  // try {
  //   const { data, error } = await supabase.functions.invoke('send-email', {
  //     body: { to, subject, html },
  //   })
  //   if (error) throw error
  //   return { success: true, data }
  // } catch (err) {
  //   console.error('Failed to send email:', err)
  //   return { success: false, error: err }
  // }

  return { success: true, pending: true }
}

// ── Convenience Functions ──

export async function notifyQualifiedLead(lead) {
  const template = qualifiedLeadConfirmation({
    fullName: lead.full_name,
    scheduledDay: lead.scheduled_day,
    scheduledTime: lead.scheduled_time,
  })
  return sendNotification({ to: lead.email, template })
}

export async function notifyColdLead(lead) {
  const template = coldLeadThankYou({ fullName: lead.full_name })
  return sendNotification({ to: lead.email, template })
}

export async function notifyAdminNewLead(lead, adminEmail) {
  const template = adminNewLeadAlert({
    fullName: lead.full_name,
    companyName: lead.company_name,
    classification: lead.classification,
    totalScore: lead.total_score,
    scheduledDay: lead.scheduled_day,
    scheduledTime: lead.scheduled_time,
  })
  return sendNotification({ to: adminEmail, template })
}
