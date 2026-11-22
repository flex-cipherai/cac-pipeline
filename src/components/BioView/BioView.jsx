import './BioView.css'

// The Link in Bio page itself — used by the public route (/l/:slug) and as
// the live phone preview in the editor. `clickHref(link)` decides where a
// link goes (public: the bio-page function, which counts and redirects).
export default function BioView({ page, links, posts = [], clickHref, preview = false }) {
  const theme = { background: '#F3F2F2', button: '#EC3013', text: '#201E1D', ...(page.theme || {}) }
  const initials = (page.title || '?').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
  return (
    <div className={`bio ${preview ? 'bio-preview' : ''}`} style={{ background: theme.background, color: theme.text }}>
      <div className="bio-inner">
        <div className="bio-avatar" style={{ borderColor: theme.button }}>
          {page.avatar_url ? <img src={page.avatar_url} alt="" /> : <span style={{ background: theme.button }}>{initials}</span>}
        </div>
        <h1 className="bio-title">{page.title || 'Your name'}</h1>
        {page.bio && <p className="bio-text">{page.bio}</p>}

        <div className="bio-links">
          {links.map(l => (
            <a key={l.id || l.label} className="bio-link" style={{ background: theme.button }}
              href={clickHref ? clickHref(l) : '#'} target={preview ? undefined : '_blank'} rel="noopener noreferrer"
              onClick={preview ? e => e.preventDefault() : undefined}>
              {l.label}
            </a>
          ))}
          {links.length === 0 && <p className="bio-text" style={{ opacity: 0.6 }}>Add your first link</p>}
        </div>

        {posts.length > 0 && (
          <>
            <div className="bio-section">Latest posts</div>
            <div className="bio-posts">
              {posts.map((p, i) => (
                <a key={i} className="bio-post" href={p.url} target={preview ? undefined : '_blank'} rel="noopener noreferrer" onClick={preview ? e => e.preventDefault() : undefined}>
                  {p.image ? <img src={p.image} alt="" /> : <span className="bio-post-text">{p.caption}</span>}
                </a>
              ))}
            </div>
          </>
        )}
        <div className="bio-foot">SDFM Group</div>
      </div>
    </div>
  )
}
