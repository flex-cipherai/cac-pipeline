// Supabase Edge Function: sm-move-to-ready
// The Assisted-Mode "publishing engine" (spec §4.1/§6.5): every few minutes,
// flips posts whose scheduled_at has passed from 'scheduled' to
// 'ready_to_post', and alerts the content team that something needs manual
// publishing. Actually posting to LinkedIn stays a manual copy/paste +
// "Mark as Posted" action in the app — this function only moves the queue.
//
// Deploy: supabase functions deploy sm-move-to-ready --no-verify-jwt
// Schedule: see migration-social-scheduler-cron.sql
// Requires the same secrets as send-email: RESEND_API_KEY, SENDER_EMAIL

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { renderTemplate, sendViaResend } from '../_shared/resend.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    const { data: due, error: dueError } = await adminClient
      .from('posts')
      .select('id, caption')
      .eq('status', 'scheduled')
      .not('scheduled_at', 'is', null)
      .lte('scheduled_at', new Date().toISOString())

    if (dueError) {
      return jsonResponse({ success: false, error: dueError.message }, 500)
    }

    if (!due || due.length === 0) {
      return jsonResponse({ success: true, moved: 0 })
    }

    const { error: updateError } = await adminClient
      .from('posts')
      .update({ status: 'ready_to_post' })
      .in('id', due.map(p => p.id))

    if (updateError) {
      return jsonResponse({ success: false, error: updateError.message }, 500)
    }

    // Notify the content team — in-app always, email if the template is active.
    const { data: recipients } = await adminClient
      .from('profiles')
      .select('id, email')
      .in('role', ['admin', 'marketing'])
      .neq('is_active', false)

    const { data: baseUrlRow } = await adminClient
      .from('system_settings').select('value').eq('key', 'app_base_url').maybeSingle()
    const calendarLink = `${(baseUrlRow?.value || '').replace(/\/$/, '')}/social/calendar`

    await adminClient.from('in_app_notifications').insert(
      (recipients || []).flatMap(r => due.map(p => ({
        user_id: r.id,
        type: 'post_ready',
        title: 'Post ready to publish',
        body: captionPreview(p.caption),
        link: '/social/calendar',
      })))
    )

    const { data: template } = await adminClient
      .from('email_templates')
      .select('*')
      .eq('template_key', 'sm_post_ready')
      .maybeSingle()

    if (template?.is_active && recipients && recipients.length > 0) {
      for (const post of due) {
        const vars = {
          scheduled_for: 'now',
          post_caption_preview: captionPreview(post.caption),
          calendar_link: calendarLink,
        }
        await Promise.allSettled(
          recipients.filter(r => r.email).map(r =>
            sendViaResend([r.email], renderTemplate(template.subject, vars), renderTemplate(template.body_html, vars))
          )
        )
      }
    }

    return jsonResponse({ success: true, moved: due.length })
  } catch (error) {
    return jsonResponse({ success: false, error: error.message }, 500)
  }
})
