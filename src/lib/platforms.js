// Social platform registry — the frontend's single source of truth for each
// network: display, status, account kinds, post types, limits and what the
// BMS can do with it. The backend mirror (publishing, sync, replies) is
// supabase/functions/_shared/platforms/. Turning on a new platform = its
// connector there + status 'live' here.

export const PLATFORMS = {
  linkedin: {
    key: 'linkedin',
    name: 'LinkedIn',
    short: 'in',
    color: '#0A66C2',
    status: 'live',
    accountKinds: { organization: 'Company Page', member: 'Profile' },
    postTypes: ['text', 'image', 'carousel', 'video', 'poll'],
    limits: {
      caption: 3000,
      seeMore: { desktop: 210, mobile: 140 },
      images: 20,
      videoMB: 200,
      documentMB: 100,
      pollQuestion: 140,
      pollOption: 30,
      pollOptions: [2, 4],
      firstComment: 1250,
    },
    // Industry-standard starting points until there is enough own data (weekday 1 = Mon).
    defaultBestTimes: [
      { weekday: 2, hour: 8 }, { weekday: 2, hour: 12 }, { weekday: 3, hour: 9 },
      { weekday: 3, hour: 12 }, { weekday: 4, hour: 9 }, { weekday: 4, hour: 13 },
    ],
    capabilities: (kind) => ({
      publish: true, firstComment: true, postStats: true,
      followers: kind === 'organization', comments: kind === 'organization', reply: kind === 'organization',
    }),
  },
  facebook: {
    key: 'facebook', name: 'Facebook', short: 'f', color: '#1877F2', status: 'coming_soon',
    accountKinds: { page: 'Page' },
    postTypes: ['text', 'image', 'video'],
    limits: { caption: 63206, seeMore: { desktop: 480, mobile: 250 }, images: 10, videoMB: 1024, firstComment: 8000 },
    defaultBestTimes: [{ weekday: 2, hour: 9 }, { weekday: 3, hour: 13 }, { weekday: 5, hour: 9 }],
    capabilities: () => ({ publish: true, firstComment: true, postStats: true, followers: true, comments: true, reply: true }),
  },
  instagram: {
    key: 'instagram', name: 'Instagram', short: 'IG', color: '#E1306C', status: 'coming_soon',
    accountKinds: { business: 'Business account', creator: 'Creator account' },
    postTypes: ['image', 'carousel', 'video'],
    limits: { caption: 2200, seeMore: { desktop: 125, mobile: 125 }, images: 10, videoMB: 1024, hashtags: 30, requiresMedia: true, firstComment: 2200 },
    defaultBestTimes: [{ weekday: 2, hour: 11 }, { weekday: 3, hour: 11 }, { weekday: 5, hour: 10 }],
    capabilities: () => ({ publish: true, firstComment: true, postStats: true, followers: true, comments: true, reply: true }),
  },
  threads: {
    key: 'threads', name: 'Threads', short: 'Th', color: '#101010', status: 'coming_soon',
    accountKinds: { profile: 'Profile' },
    postTypes: ['text', 'image', 'carousel', 'video'],
    limits: { caption: 500, seeMore: { desktop: 500, mobile: 500 }, images: 10, videoMB: 1024 },
    defaultBestTimes: [{ weekday: 2, hour: 9 }, { weekday: 4, hour: 12 }],
    capabilities: () => ({ publish: true, firstComment: false, postStats: true, followers: true, comments: true, reply: true }),
  },
  tiktok: {
    key: 'tiktok', name: 'TikTok', short: 'TT', color: '#000000', status: 'coming_soon',
    accountKinds: { business: 'Business account', creator: 'Creator account' },
    postTypes: ['video', 'carousel'],
    limits: { caption: 2200, seeMore: { desktop: 150, mobile: 100 }, videoMB: 4096, requiresMedia: true },
    defaultBestTimes: [{ weekday: 2, hour: 19 }, { weekday: 4, hour: 19 }, { weekday: 5, hour: 17 }],
    capabilities: () => ({ publish: true, firstComment: false, postStats: true, followers: true, comments: true, reply: true }),
  },
  x: {
    key: 'x', name: 'X', short: 'X', color: '#000000', status: 'coming_soon',
    accountKinds: { profile: 'Profile' },
    postTypes: ['text', 'image', 'video', 'poll'],
    limits: { caption: 280, seeMore: { desktop: 280, mobile: 280 }, images: 4, videoMB: 512, pollOption: 25, pollOptions: [2, 4], firstComment: 280 },
    defaultBestTimes: [{ weekday: 2, hour: 9 }, { weekday: 3, hour: 9 }, { weekday: 4, hour: 9 }],
    capabilities: () => ({ publish: true, firstComment: true, postStats: true, followers: true, comments: true, reply: true }),
  },
  youtube: {
    key: 'youtube', name: 'YouTube', short: 'YT', color: '#FF0000', status: 'coming_soon',
    accountKinds: { page: 'Channel' },
    postTypes: ['video'],
    limits: { caption: 5000, seeMore: { desktop: 160, mobile: 100 }, videoMB: 2048, requiresMedia: true },
    defaultBestTimes: [{ weekday: 4, hour: 15 }, { weekday: 5, hour: 15 }, { weekday: 6, hour: 10 }],
    capabilities: () => ({ publish: true, firstComment: true, postStats: true, followers: true, comments: true, reply: true }),
  },
}

export const PLATFORM_LIST = Object.values(PLATFORMS)
export const LIVE_PLATFORMS = PLATFORM_LIST.filter(p => p.status === 'live')

export const POST_TYPE_LABELS = {
  text: 'Text', image: 'Image', carousel: 'Document / Carousel', video: 'Video', poll: 'Poll',
}

export function platformOf(account) {
  return PLATFORMS[account?.platform] || PLATFORMS.linkedin
}

export function accountKindLabel(account) {
  return platformOf(account).accountKinds[account?.account_type] || ''
}

export function capabilitiesOf(account) {
  return platformOf(account).capabilities(account?.account_type)
}

// Problems a post would hit on this account's platform, as plain sentences.
// `post` = { caption, hashtags, postType, assets: [{file_type}], pollQuestion, pollOptions, firstComment }
export function validateForAccount(account, post) {
  const p = platformOf(account)
  const L = p.limits
  const problems = []
  const text = [post.caption?.trim(), (post.hashtags || []).map(h => `#${h}`).join(' ')].filter(Boolean).join('\n\n')
  if (!p.postTypes.includes(post.postType)) problems.push(`${p.name} doesn't support ${POST_TYPE_LABELS[post.postType]?.toLowerCase() || post.postType} posts`)
  if (L.caption && text.length > L.caption) problems.push(`Caption is ${text.length - L.caption} characters over ${p.name}'s ${L.caption.toLocaleString()} limit`)
  if (post.postType === 'text' && !text.trim()) problems.push('Write a caption')
  const assets = post.assets || []
  if (L.requiresMedia && assets.length === 0) problems.push(`${p.name} needs an image or video`)
  if (['image', 'video', 'carousel'].includes(post.postType) && assets.length === 0) problems.push('Attach media from the Library')
  if (post.postType === 'image') {
    if (assets.some(a => a.file_type !== 'image')) problems.push('Image posts can only contain images')
    if (L.images && assets.length > L.images) problems.push(`${p.name} allows up to ${L.images} images`)
  }
  if (post.postType === 'video' && assets.some(a => a.file_type !== 'video')) problems.push('Attach a video file')
  if (post.postType === 'carousel' && account?.platform === 'linkedin' && assets.some(a => a.file_type !== 'document')) problems.push('Attach a PDF, PPTX or DOCX document')
  if (post.postType === 'poll') {
    const opts = (post.pollOptions || []).map(o => o.trim()).filter(Boolean)
    if (!post.pollQuestion?.trim()) problems.push('Add a poll question')
    if (L.pollQuestion && post.pollQuestion?.trim().length > L.pollQuestion) problems.push(`Poll question must be ${L.pollQuestion} characters or fewer`)
    if (L.pollOptions && (opts.length < L.pollOptions[0] || opts.length > L.pollOptions[1])) problems.push(`A poll needs ${L.pollOptions[0]}–${L.pollOptions[1]} options`)
    if (L.pollOption && opts.some(o => o.length > L.pollOption)) problems.push(`Poll options must be ${L.pollOption} characters or fewer`)
  }
  if (post.firstComment?.trim()) {
    if (!capabilitiesOf(account).firstComment) problems.push(`${p.name} first comments aren't supported`)
    else if (L.firstComment && post.firstComment.length > L.firstComment) problems.push(`First comment is over ${L.firstComment} characters`)
  }
  return problems
}
