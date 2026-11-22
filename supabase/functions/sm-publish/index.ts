// Supabase Edge Function: sm-publish
// Publishes one post to LinkedIn right away — the Content Calendar's
// "Retry" (a failed post) and "Publish now" (a scheduled or ready post).
// Scheduled publishing itself runs in sm-move-to-ready.
//
// Body: { post_id }
// Caller must be signed in with access to the Content Calendar.
//
// Deploy: supabase functions deploy sm-publish
// Requires: LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET (+ RESEND_API_KEY, SENDER_EMAIL for alerts)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { userHasModule } from '../_shared/access.ts'
import { claimPosts, countAttempt, publishPost } from '../_shared/linkedinPublish.ts'

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonResponse({ success: false, error: 'Missing authorization' })

    const anonClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: { user }, error: authError } = await anonClient.auth.getUser()
    if (authError || !user) return jsonResponse({ success: false, error: 'Unauthorized — please sign in again' })

    const adminClient = createClient(supabaseUrl, serviceRoleKey)
    if (!(await userHasModule(adminClient, user.id, 'social_calendar', ['admin', 'marketing']))) {
      return jsonResponse({ success: false, error: 'You do not have access to the Content Calendar' })
    }

    const { post_id } = await req.json().catch(() => ({}))
    if (!post_id) return jsonResponse({ success: false, error: 'post_id is required' })

    const { data: post } = await adminClient
      .from('posts')
      .select('id, status, is_template, connected_accounts(account_type, owner_profile_id, mode, status, external_page_id)')
      .eq('id', post_id)
      .maybeSingle()
    if (!post || post.is_template) return jsonResponse({ success: false, error: 'Post not found' })

    // deno-lint-ignore no-explicit-any
    const account = post.connected_accounts as any
    if (account?.account_type === 'member' && account.owner_profile_id !== user.id) {
      return jsonResponse({ success: false, error: 'Only the owner of this LinkedIn profile can publish to it' })
    }
    if (!account || account.mode !== 'automated' || account.status !== 'active' || !account.external_page_id) {
      return jsonResponse({ success: false, error: 'This LinkedIn account is not connected for automatic publishing — post it manually' })
    }

    // A retry starts the upload over, in case the media itself was the problem.
    if (post.status === 'failed') {
      await adminClient.from('posts').update({ publish_state: null, publish_error: null }).eq('id', post_id)
    }

    const claimed = await claimPosts(adminClient, [post_id], ['failed', 'scheduled', 'ready_to_post'])
    if (claimed.length === 0) {
      return jsonResponse({ success: false, error: post.status === 'posted' ? 'Already published' : 'The post is already being published' })
    }
    await countAttempt(adminClient, post_id)

    const result = await publishPost(adminClient, post_id)
    if (result.result === 'posted') return jsonResponse({ success: true, status: 'posted', url: result.url })
    if (result.result === 'pending') {
      return jsonResponse({ success: true, status: 'publishing', message: `Uploaded — LinkedIn is still processing the media (${result.reason}). It will go out automatically within a few minutes.` })
    }
    return jsonResponse({ success: false, error: result.error })
  } catch (err) {
    return jsonResponse({ success: false, error: (err as Error).message || 'Internal server error' })
  }
})
