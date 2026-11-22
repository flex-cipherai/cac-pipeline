// Supabase Edge Function: sm-autolists
// Evergreen autolists (Metricool-style): each active autolist has weekly
// time slots and a rotation of template posts. Every hour this keeps the
// next 7 days of its slots filled: for each empty upcoming slot it copies the
// next item (skipping ones used within avoid_repeat_days when it can) into a
// scheduled post for each of the autolist's accounts — one post group per
// slot. The publishing engine then handles them like any scheduled post.
//
// Deploy: supabase functions deploy sm-autolists --no-verify-jwt
// Schedule: migration-social-v2-cron.sql (hourly)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { upcomingSlots } from '../_shared/zoned.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const HORIZON_DAYS = 7

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

// deno-lint-ignore no-explicit-any
async function fillAutolist(db: any, list: any) {
  const { data: items } = await db.from('autolist_items')
    .select('id, post_id, position, use_count, last_used_at, posts(*)')
    .eq('autolist_id', list.id).order('position')
  // deno-lint-ignore no-explicit-any
  const usable = (items || []).filter((i: any) => i.posts)
  if (!usable.length || !list.account_ids?.length || !(list.slots || []).length) return 0

  // Only active accounts.
  const { data: accounts } = await db.from('connected_accounts').select('id, mode').in('id', list.account_ids).eq('status', 'active')
  if (!accounts?.length) return 0

  const now = new Date()
  const start = list.filled_until && new Date(list.filled_until) > now ? new Date(list.filled_until) : now
  const horizon = new Date(now.getTime() + HORIZON_DAYS * 86400000)
  const slots = upcomingSlots(list.slots, list.timezone || 'Africa/Nairobi', start, horizon)
  if (!slots.length) return 0

  let cursor = list.cursor || 0
  let created = 0
  const avoidMs = (list.avoid_repeat_days || 0) * 86400000
  for (const at of slots) {
    // Next item in rotation that was not used recently; else the least recently used.
    let pick = null
    for (let k = 0; k < usable.length; k++) {
      const cand = usable[(cursor + k) % usable.length]
      if (!cand.last_used_at || at.getTime() - new Date(cand.last_used_at).getTime() >= avoidMs) { pick = cand; cursor = (cursor + k + 1) % usable.length; break }
    }
    if (!pick) {
      pick = [...usable].sort((a, b) => new Date(a.last_used_at || 0).getTime() - new Date(b.last_used_at || 0).getTime())[0]
      cursor = (usable.indexOf(pick) + 1) % usable.length
    }

    const t = pick.posts
    const groupId = crypto.randomUUID()
    const { data: assets } = await db.from('post_assets').select('asset_id, position').eq('post_id', t.id)
    for (const acc of accounts) {
      const { data: post, error } = await db.from('posts').insert({
        account_id: acc.id, post_type: t.post_type, caption: t.caption, hashtags: t.hashtags, mentions: t.mentions,
        pillar_id: t.pillar_id, campaign_id: t.campaign_id, utm_url: t.utm_url, mode: acc.mode,
        poll_options: t.poll_options, poll_question: t.poll_question, poll_duration: t.poll_duration,
        first_comment: t.first_comment, created_by: list.created_by || t.created_by,
        status: 'scheduled', scheduled_at: at.toISOString(), post_group_id: groupId, autolist_id: list.id, queued: true,
      }).select('id').single()
      if (error || !post) { console.error('[sm-autolists] insert:', error?.message); continue }
      if (assets?.length) {
        await db.from('post_assets').insert(assets.map((a: { asset_id: string; position: number }) => ({ post_id: post.id, asset_id: a.asset_id, position: a.position })))
      }
      created++
    }
    pick.last_used_at = at.toISOString()
    pick.use_count = (pick.use_count || 0) + 1
    await db.from('autolist_items').update({ last_used_at: pick.last_used_at, use_count: pick.use_count }).eq('id', pick.id)
  }

  await db.from('autolists').update({ cursor, filled_until: slots[slots.length - 1].toISOString() }).eq('id', list.id)
  return created
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const body = await req.json().catch(() => ({}))
    let query = db.from('autolists').select('*').eq('active', true)
    if (body?.autolist_id) query = query.eq('id', body.autolist_id)
    const { data: lists, error } = await query
    if (error) return jsonResponse({ success: false, error: error.message }, 500)

    const report: Record<string, number> = {}
    for (const list of lists || []) {
      try { report[list.name] = await fillAutolist(db, list) } catch (err) { console.error('[sm-autolists]', list.name, (err as Error).message) }
    }
    return jsonResponse({ success: true, created: report })
  } catch (err) {
    return jsonResponse({ success: false, error: (err as Error).message }, 500)
  }
})
