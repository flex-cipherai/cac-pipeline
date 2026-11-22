import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import BioView from '../../components/BioView/BioView'

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bio-page`
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

// Public Link in Bio page (/l/:slug) — no sign-in. Content comes from the
// bio-page Edge Function; link clicks go through it (counted, then redirected).
export default function BioPage() {
  const { slug } = useParams()
  const [state, setState] = useState({ loading: true })

  useEffect(() => {
    fetch(`${FN_URL}?slug=${encodeURIComponent(slug)}`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } })
      .then(r => r.json())
      .then(d => {
        setState(d.success ? { data: d } : { error: true })
        if (d.success) document.title = d.page.title
      })
      .catch(() => setState({ error: true }))
  }, [slug])

  if (state.loading) return <div style={{ minHeight: '100vh', background: '#F3F2F2' }} />
  if (state.error) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Arial, sans-serif', background: '#F3F2F2', color: '#201E1D', padding: 16, textAlign: 'center' }}>
        This page isn't available.
      </div>
    )
  }
  const { page, links, posts } = state.data
  return <BioView page={page} links={links} posts={posts} clickHref={l => `${FN_URL}?click=${l.id}`} />
}
