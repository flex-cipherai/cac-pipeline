import { useState } from 'react'
import LinkedInPostPreview from '../LinkedInPostPreview/LinkedInPostPreview'
import { platformOf } from '../../lib/platforms'
import { AccountAvatar } from '../social/SocialUI'
import './PostPreview.css'

// Live preview of a post as it will look on the account's network. LinkedIn
// has its own faithful preview; other networks share a generic card that
// uses each platform's "see more" cut-off from the registry until they get
// their own (add a case below when a connector goes live).
export default function PostPreview({ account, caption, hashtags, postType, assets, device, firstComment, pollQuestion, pollOptions }) {
  const p = platformOf(account)
  if (p.key === 'linkedin') {
    return (
      <div>
        <LinkedInPostPreview accountName={account?.account_name} caption={caption} hashtags={hashtags} postType={postType} assets={assets} device={device} />
        {postType === 'poll' && pollQuestion && <PollPreview question={pollQuestion} options={pollOptions} />}
        {firstComment?.trim() && <FirstComment account={account} text={firstComment} />}
      </div>
    )
  }
  return <GenericPreview account={account} caption={caption} hashtags={hashtags} assets={assets} device={device} firstComment={firstComment} />
}

function PollPreview({ question, options }) {
  return (
    <div className="pp-poll">
      <div className="pp-poll-q">{question}</div>
      {(options || []).filter(Boolean).map((o, i) => <div key={i} className="pp-poll-opt">{o}</div>)}
    </div>
  )
}

function FirstComment({ account, text }) {
  return (
    <div className="pp-comment">
      <AccountAvatar account={account} size={24} />
      <div className="pp-comment-bubble"><b>{account?.account_name}</b><div>{text}</div></div>
    </div>
  )
}

function GenericPreview({ account, caption, hashtags, assets, device, firstComment }) {
  const [expanded, setExpanded] = useState(false)
  const p = platformOf(account)
  const text = [caption?.trim(), (hashtags || []).map(h => `#${h}`).join(' ')].filter(Boolean).join('\n\n')
  const limit = p.limits.seeMore?.[device] || 200
  const cut = !expanded && text.length > limit
  return (
    <div className="pp-card" style={{ borderTopColor: p.color }}>
      <div className="pp-head">
        <AccountAvatar account={account} size={36} />
        <div><b>{account?.account_name}</b><div className="pp-sub">{p.name} · now</div></div>
      </div>
      <div className="pp-text">
        {cut ? text.slice(0, limit).trimEnd() : text}
        {cut && <button className="pp-more" onClick={() => setExpanded(true)}>…more</button>}
      </div>
      {assets?.length > 0 && (
        <div className={`pp-media pp-media-${Math.min(assets.length, 4)}`}>
          {assets.slice(0, 4).map(a => a.previewUrl ? <img key={a.id} src={a.previewUrl} alt="" /> : <div key={a.id} className="pp-media-file">{a.file_type === 'video' ? '▶ Video' : '📄 Document'}</div>)}
        </div>
      )}
      {firstComment?.trim() && <FirstComment account={account} text={firstComment} />}
    </div>
  )
}
