import { useState } from 'react'
import './LinkedInPostPreview.css'

// Simulates how a post renders on LinkedIn (desktop/mobile), including the
// "…see more" truncation point — spec §6.1 "Live preview".
// LinkedIn's feed truncates around ~210 characters on desktop, tighter on
// mobile; this approximates that so the composer can show it live.
const TRUNCATE_DESKTOP = 210
const TRUNCATE_MOBILE = 140

export default function LinkedInPostPreview({
  accountName = 'SDFM Group Limited',
  caption = '',
  hashtags = [],
  postType = 'text',
  assets = [],
  device = 'desktop',
}) {
  const [expanded, setExpanded] = useState(false)

  const hashtagLine = hashtags.length > 0 ? hashtags.map(h => `#${h.replace(/^#/, '')}`).join(' ') : ''
  const fullText = [caption.trim(), hashtagLine].filter(Boolean).join('\n\n')
  const limit = device === 'mobile' ? TRUNCATE_MOBILE : TRUNCATE_DESKTOP
  const needsTruncation = fullText.length > limit
  const displayText = expanded || !needsTruncation ? fullText : fullText.slice(0, limit).trimEnd()

  return (
    <div className={`li-preview li-preview-${device}`}>
      <div className="li-preview-header">
        <div className="li-preview-avatar">S</div>
        <div className="li-preview-identity">
          <span className="li-preview-name">{accountName}</span>
          <span className="li-preview-meta">Just now · <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M1 8h14M8 1a10 10 0 010 14M8 1a10 10 0 000 14" fill="none" stroke="currentColor" strokeWidth="1" /></svg></span>
        </div>
      </div>

      <div className="li-preview-body">
        {fullText ? (
          <p className="li-preview-text">
            {displayText}
            {!expanded && needsTruncation && (
              <>
                &hellip;{' '}
                <button type="button" className="li-preview-seemore" onClick={() => setExpanded(true)}>see more</button>
              </>
            )}
          </p>
        ) : (
          <p className="li-preview-text li-preview-placeholder">Your post caption will appear here…</p>
        )}
      </div>

      {postType !== 'text' && (
        <div className={`li-preview-media li-preview-media-${postType}`}>
          {postType === 'poll' ? (
            <div className="li-preview-poll">Poll preview</div>
          ) : assets.length > 0 ? (
            <div className={`li-preview-media-grid count-${Math.min(assets.length, 4)}`}>
              {assets.slice(0, 4).map((a, i) => (
                a.previewUrl && postType !== 'video' ? (
                  <img key={i} src={a.previewUrl} alt="" className="li-preview-media-img" />
                ) : (
                  <div key={i} className="li-preview-media-placeholder">{postType === 'video' ? '▶' : postType === 'carousel' ? '📄' : '🖼'}</div>
                )
              ))}
            </div>
          ) : (
            <div className="li-preview-media-placeholder">
              {postType === 'video' ? '▶ Video' : postType === 'carousel' ? '📄 Document / Carousel' : '🖼 Image'}
            </div>
          )}
        </div>
      )}

      <div className="li-preview-actions">
        <span>👍 Like</span>
        <span>💬 Comment</span>
        <span>🔁 Repost</span>
        <span>➤ Send</span>
      </div>
    </div>
  )
}
