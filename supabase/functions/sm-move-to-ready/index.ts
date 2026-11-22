// Supabase Edge Function: sm-move-to-ready
// The publishing engine, run every 5 minutes by pg_cron. For each post
// whose scheduled_at has passed:
//   - Automated Mode (the post's LinkedIn account is connected through the
//     API): publish it to LinkedIn now (see _shared/linkedinPublish.ts).
//     Posts left in 'publishing' (a video still processing on LinkedIn, or a
//     run that stopped halfway) are resumed once their lock expires.
//   - Assisted Mode: move it to 'ready_to_post' and alert the content team
//     to post it by hand (copy/paste + Mark as Posted).
//
// Deploy: supabase functions deploy sm-move-to-ready --no-verify-jwt
// Schedule: see migration-social-scheduler-cron.sql
// Requires: RESEND_API_KEY, SENDER_EMAIL, LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { renderTemplate, sendViaResend } from '../_shared/resend.ts'
import { staffWithModule } from '../_shared/access.ts'
import { claimPosts, countAttempt, publishPost } from '../_shared/linkedinPublish.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Stop starting new publishes after this long so the function finishes
// inside the Edge Function time limit; the rest go out on the next run.
const TIME_BUDGET_MS = 100 * 1000

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

function isAutomated(account: { mode?: string; status?: string; external_page_id?: string | null } | null) {
  return !!account && account.mode === 'automated' && account.status === 'active' && !!account.external_page_id
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const startedAt = Date.now()
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const adminClient = createClient(supabaseUrl, serviceRoleKey)
    const nowIso = new Date().toISOString()

    const { data: due, error: dueError } = await adminClient
      .from('posts')
      .select('id, caption, connected_accounts(mode, status, external_page_id)')
      .eq('status', 'scheduled')
      .eq('is_template', false)
      .not('scheduled_at', 'is', null)
      .lte('scheduled_at', nowIso)
      .order('scheduled_at')

    if (dueError) {
      return jsonResponse({ success: false, error: dueError.message }, 500)
    }

    // deno-lint-ignore no-explicit-any
    const dueAutomated = (due || []).filter((p: any) => isAutomated(p.connected_accounts))
    // deno-lint-ignore no-explicit-any
    const dueAssisted = (due || []).filter((p: any) => !isAutomated(p.connected_accounts))

    // ── Automated: publish ──
    const results: Record<string, string> = {}
    const claimed = await claimPosts(adminClient, dueAutomated.map((p: { id: string }) => p.id), ['scheduled'])
    for (const id of claimed) await countAttempt(adminClient, id)

    // Resume posts stuck in 'publishing' whose lock has expired.
    const { data: stale } = await adminClient
      .from('posts').select('id').eq('status', 'publishing').lt('publish_lock_until', nowIso)
    const resumed = await claimPosts(adminClient, (stale || []).map((p: { id: string }) => p.id), ['publishing'])

    const toPublish = [...claimed, ...resumed]
    for (let i = 0; i < toPublish.length; i++) {
      const id = toPublish[i]
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        // Release the rest for the next run.
        await adminClient.from('posts').update({ publish_lock_until: nowIso }).in('id', toPublish.slice(i))
        break
      }
      const res = await publishPost(adminClient, id)
      results[id] = res.result === 'failed' ? `failed: ${res.error}` : res.result
    }

    // ── Assisted: queue for manual posting ──
    let moved = 0
    if (dueAssisted.length > 0) {
      const { data: movedRows, error: updateError } = await adminClient
        .from('posts')
        .update({ status: 'ready_to_post' })
        .in('id', dueAssisted.map((p: { id: string }) => p.id))
        .eq('status', 'scheduled')
        .select('id, caption')

      if (updateError) {
        return jsonResponse({ success: false, error: updateError.message, published: results }, 500)
      }
      moved = movedRows?.length || 0
      if (moved > 0) await notifyReady(adminClient, movedRows!)
    }

    return jsonResponse({ success: true, moved, published: results })
  } catch (error) {
    return jsonResponse({ success: false, error: (error as Error).message }, 500)
  }
})

// deno-lint-ignore no-explicit-any
async function notifyReady(adminClient: any, posts: { id: string; caption: string | null }[]) {
  const recipients = await staffWithModule(adminClient, 'social_calendar', ['admin', 'marketing'], 'id, email')

  const { data: baseUrlRow } = await adminClient
    .from('system_settings').select('value').eq('key', 'app_base_url').maybeSingle()
  const calendarLink = `${(baseUrlRow?.value || '').replace(/\/$/, '')}/social/calendar`

  await adminClient.from('in_app_notifications').insert(
    (recipients || []).flatMap((r: { id: string }) => posts.map(p => ({
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
    for (const post of posts) {
      const vars = {
        scheduled_for: 'now',
        post_caption_preview: captionPreview(post.caption),
        calendar_link: calendarLink,
      }
      await Promise.allSettled(
        recipients.filter((r: { email?: string }) => r.email).map((r: { email: string }) =>
          sendViaResend([r.email], renderTemplate(template.subject, vars), renderTemplate(template.body_html, vars))
        )
      )
    }
  }
}
