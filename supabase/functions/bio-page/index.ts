// Supabase Edge Function: bio-page
// Public Link in Bio (Metricool "SmartLinks"). The page itself is the
// app's public route /l/:slug, which calls this function — bio_pages /
// bio_links stay closed to anonymous users; only published pages are served.
//
//   GET ?slug=<slug>      → { page, links, posts } (counts a view)
//   GET ?click=<link id>  → counts the click and 302-redirects to the link
//                            (with utm_source=linkinbio when add_utm is on)
//
// Deploy: supabase functions deploy bio-page --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
  })
}

function withUtm(raw: string, slug: string) {
  try {
    const url = new URL(raw)
    if (!url.searchParams.has('utm_source')) url.searchParams.set('utm_source', 'linkinbio')
    if (!url.searchParams.has('utm_medium')) url.searchParams.set('utm_medium', 'social')
    if (!url.searchParams.has('utm_campaign')) url.searchParams.set('utm_campaign', slug)
    return url.toString()
  } catch {
    return raw
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const params = new URL(req.url).searchParams

  try {
    const clickId = params.get('click')
    if (clickId) {
      const { data: link } = await db.from('bio_links')
        .select('id, url, clicks, add_utm, active, bio_pages(slug, published)').eq('id', clickId).maybeSingle()
      if (!link || !link.active || !link.bio_pages?.published || !/^https?:\/\//i.test(link.url)) {
        return new Response('Link not found', { status: 404, headers: corsHeaders })
      }
      await db.from('bio_links').update({ clicks: (link.clicks || 0) + 1 }).eq('id', link.id)
      const target = link.add_utm ? withUtm(link.url, link.bio_pages.slug) : link.url
      return new Response(null, { status: 302, headers: { ...corsHeaders, Location: target, 'Cache-Control': 'no-store' } })
    }

    const slug = (params.get('slug') || '').toLowerCase()
    if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) return jsonResponse({ success: false, error: 'Page not found' }, 404)

    const { data: page } = await db.from('bio_pages')
      .select('id, slug, title, bio, avatar_url, theme, account_ids, show_latest_posts, views, published')
      .eq('slug', slug).maybeSingle()
    if (!page || !page.published) return jsonResponse({ success: false, error: 'Page not found' }, 404)

    await db.from('bio_pages').update({ views: (page.views || 0) + 1 }).eq('id', page.id)

    const { data: links } = await db.from('bio_links').select('id, label').eq('page_id', page.id).eq('active', true).order('position')

    // Latest published posts (with an image thumbnail when the post has one).
    let posts: { url: string; caption: string; image: string | null; posted_at: string }[] = []
    if (page.show_latest_posts && page.account_ids?.length) {
      const { data: rows } = await db.from('posts')
        .select('id, caption, external_post_url, posted_at, post_assets(position, content_assets(file_path, file_type))')
        .in('account_id', page.account_ids).eq('status', 'posted').not('external_post_url', 'is', null)
        .order('posted_at', { ascending: false }).limit(6)
      posts = await Promise.all((rows || []).map(async (p: any) => {
        const img = (p.post_assets || []).sort((a: any, b: any) => a.position - b.position)
          .map((pa: any) => pa.content_assets).find((a: any) => a?.file_type === 'image')
        let image: string | null = null
        if (img) {
          const { data } = await db.storage.from('content-library').createSignedUrl(img.file_path, 6 * 3600)
          image = data?.signedUrl || null
        }
        return { url: p.external_post_url, caption: (p.caption || '').slice(0, 120), image, posted_at: p.posted_at }
      }))
    }

    return jsonResponse({
      success: true,
      page: { slug: page.slug, title: page.title, bio: page.bio, avatar_url: page.avatar_url, theme: page.theme },
      links: links || [],
      posts,
    })
  } catch (err) {
    return jsonResponse({ success: false, error: (err as Error).message }, 500)
  }
})
