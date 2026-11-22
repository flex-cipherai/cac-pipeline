// Supabase Edge Function: sm-reply
// Inbox: reply to a synced comment, posted on the platform as the account
// (the Company Page on LinkedIn). The reply is stored as an outbound
// activity_events row and the comment is marked handled.
//
// Body: { event_id, text }
// Caller must be signed in with access to the Inbox (social_activity).
//
// Deploy: supabase functions deploy sm-reply

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { userHasModule } from '../_shared/access.ts'
import { getConnector, hasConnector } from '../_shared/platforms/index.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonResponse({ success: false, error: 'Missing authorization' })
    const anon = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } })
    const { data: { user } } = await anon.auth.getUser()
    if (!user) return jsonResponse({ success: false, error: 'Unauthorized — please sign in again' })

    const db = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    if (!(await userHasModule(db, user.id, 'social_activity', ['admin', 'marketing']))) {
      return jsonResponse({ success: false, error: 'You do not have access to the Inbox' })
    }

    const { event_id, text } = await req.json().catch(() => ({}))
    const reply = String(text || '').trim()
    if (!event_id || !reply) return jsonResponse({ success: false, error: 'Write a reply first' })
    if (reply.length > 1250) return jsonResponse({ success: false, error: 'Replies are limited to 1,250 characters' })

    const { data: event } = await db.from('activity_events')
      .select('*, posts(external_post_urn, external_post_url), connected_accounts(*)')
      .eq('id', event_id).maybeSingle()
    if (!event || event.event_type !== 'comment' || !event.external_id) {
      return jsonResponse({ success: false, error: 'Only comments synced from the platform can be answered here' })
    }
    const account = event.connected_accounts
    const postUrn = event.posts?.external_post_urn
    if (!account || !postUrn || !hasConnector(account.platform)) {
      return jsonResponse({ success: false, error: 'This comment\'s account is not connected' })
    }

    const connector = getConnector(account.platform)
    if (!connector.capabilities(account).reply || !connector.replyToComment) {
      return jsonResponse({ success: false, error: `Replying is not available for ${account.account_name}` })
    }

    const token = await connector.getToken(db, account)
    // Reply in the same thread: to the top-level comment the person wrote under.
    const parent = event.parent_external_id || event.external_id
    let replyId = ''
    try {
      replyId = await connector.replyToComment(token, account, postUrn, parent, reply)
    } catch (err) {
      const msg = (err as Error).message
      return jsonResponse({
        success: false,
        error: /403|ACCESS_DENIED|scope/i.test(msg)
          ? 'LinkedIn refused the reply — reconnect LinkedIn in Settings → Integrations to grant reply permission'
          : msg,
      })
    }

    const now = new Date().toISOString()
    await db.from('activity_events').insert({
      account_id: account.id, post_id: event.post_id, event_type: 'comment', direction: 'outbound',
      content: reply, author_name: account.account_name, occurred_at: now,
      external_url: event.external_url, external_id: replyId || null, parent_external_id: parent,
      source: 'api', triage_status: 'handled', created_by: user.id,
    })
    await db.from('activity_events').update({ triage_status: 'handled', replied_at: now }).eq('id', event_id)

    return jsonResponse({ success: true })
  } catch (err) {
    return jsonResponse({ success: false, error: (err as Error).message || 'Internal server error' })
  }
})
