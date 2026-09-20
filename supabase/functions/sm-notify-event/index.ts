// Supabase Edge Function: sm-notify-event
// Sends in-app + email notifications for social media approval events.
// Invoked from the app (like notify-lead-stage) right after the caller
// writes a post_approval_history row — this function does the notifying,
// not the state change, so it runs with the service role purely to reach
// email_templates/profiles regardless of the caller's RLS.
//
// Body: { event: 'approval_requested' | 'approval_decision', post_id, actor_id, comment? }
//
// Deploy: supabase functions deploy sm-notify-event
// Requires the same secrets as send-email: RESEND_API_KEY, SENDER_EMAIL

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { renderTemplate, requireResendKey, sendViaResend } from '../_shared/resend.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const DECISION_LABELS: Record<string, string> = {
  approved: 'Approved',
  changes_requested: 'Sent Back for Changes',
  rejected: 'Rejected',
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function captionPreview(caption: string | null) {
  const text = (caption || '').trim()
  return text.length > 140 ? `${text.slice(0, 140)}…` : text
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { event, post_id, actor_id, decision, comment, milestone, current_count, account_name } = body
    if (!event) {
      return jsonResponse({ success: false, error: 'Missing event' }, 400)
    }
    if (!['approval_requested', 'approval_decision', 'follower_milestone'].includes(event)) {
      return jsonResponse({ success: false, error: 'Unsupported event' }, 400)
    }
    if ((event === 'approval_requested' || event === 'approval_decision') && (!post_id || !actor_id)) {
      return jsonResponse({ success: false, error: 'post_id and actor_id are required for approval events' }, 400)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    if (event === 'follower_milestone') {
      const { data: recipients } = await adminClient.from('profiles').select('id, email').in('role', ['admin', 'marketing']).neq('is_active', false)
      const valid = (recipients || []).filter(r => r.email)

      await adminClient.from('in_app_notifications').insert(
        (recipients || []).map(r => ({
          user_id: r.id, type: 'follower_milestone', title: `${milestone} followers reached`,
          body: `${account_name || 'The LinkedIn page'} now has ${current_count} followers.`, link: '/social/activity',
        }))
      )

      const { data: template } = await adminClient.from('email_templates').select('*').eq('template_key', 'sm_follower_milestone').maybeSingle()
      if (template?.is_active && valid.length > 0) {
        requireResendKey()
        const vars = { account_name: account_name || 'The LinkedIn page', milestone: String(milestone), current_count: String(current_count) }
        await Promise.allSettled(valid.map(r => sendViaResend([r.email], renderTemplate(template.subject, vars), renderTemplate(template.body_html, vars))))
      }
      return jsonResponse({ success: true })
    }

    const { data: post, error: postError } = await adminClient
      .from('posts')
      .select('id, caption, created_by, scheduled_at, content_pillars(name)')
      .eq('id', post_id)
      .single()

    if (postError || !post) {
      return jsonResponse({ success: false, error: postError?.message || 'Post not found' }, 404)
    }

    const { data: actor } = await adminClient.from('profiles').select('id, name').eq('id', actor_id).single()

    const { data: baseUrlRow } = await adminClient
      .from('system_settings').select('value').eq('key', 'app_base_url').maybeSingle()
    const appUrl = (baseUrlRow?.value || '').replace(/\/$/, '')

    let recipients: { id: string; email: string }[] = []
    let templateKey = ''
    let vars: Record<string, unknown> = {}
    let notifTitle = ''
    let notifLink = ''

    if (event === 'approval_requested') {
      const { data: admins } = await adminClient.from('profiles').select('id, email').eq('role', 'admin')
      recipients = (admins || []).filter(p => p.email)
      templateKey = 'sm_approval_requested'
      vars = {
        submitted_by: actor?.name || 'A team member',
        pillar: (post as any).content_pillars?.name || 'Uncategorized',
        scheduled_for: post.scheduled_at ? new Date(post.scheduled_at).toLocaleString('en-GB') : 'Not yet scheduled',
        post_caption_preview: captionPreview(post.caption),
        review_link: `${appUrl}/social/approvals`,
      }
      notifTitle = 'Post submitted for approval'
      notifLink = '/social/approvals'
    } else {
      if (!post.created_by) {
        return jsonResponse({ success: true, note: 'Post has no author to notify' })
      }
      const { data: author } = await adminClient.from('profiles').select('id, email').eq('id', post.created_by).single()
      recipients = author?.email ? [{ id: author.id, email: author.email }] : []
      templateKey = 'sm_approval_decision'
      const decisionLabel = DECISION_LABELS[decision] || decision
      vars = {
        decision: decisionLabel,
        decided_by: actor?.name || 'Admin',
        comment: comment || '—',
        post_caption_preview: captionPreview(post.caption),
        review_link: `${appUrl}/social/calendar`,
      }
      notifTitle = `Post ${decisionLabel.toLowerCase()}`
      notifLink = '/social/calendar'
    }

    if (recipients.length > 0) {
      await adminClient.from('in_app_notifications').insert(
        recipients.map(r => ({
          user_id: r.id,
          type: event,
          title: notifTitle,
          body: captionPreview(post.caption),
          link: notifLink,
        }))
      )
    }

    const { data: template } = await adminClient
      .from('email_templates').select('*').eq('template_key', templateKey).maybeSingle()

    if (!template?.is_active || recipients.length === 0) {
      return jsonResponse({ success: true, emailed: 0, note: !template?.is_active ? 'Template inactive' : 'No recipients' })
    }

    requireResendKey()
    const sends = await Promise.allSettled(
      recipients.map(r => sendViaResend([r.email], renderTemplate(template.subject, vars), renderTemplate(template.body_html, vars)))
    )
    const failed = sends.filter(s => s.status === 'rejected').length

    return jsonResponse({ success: true, emailed: recipients.length - failed, failed })
  } catch (error) {
    return jsonResponse({ success: false, error: error.message }, 500)
  }
})
