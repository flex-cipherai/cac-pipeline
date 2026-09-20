// UTM link builder for the Social Media module — auto-tags links dropped
// into a post so LinkedIn traffic is attributable end to end, consistent
// with the tracking already live on the Sales Pipeline (leads.source).

export function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export function buildUtmUrl(rawUrl, { source = 'linkedin', medium = 'social', campaign } = {}) {
  const trimmed = String(rawUrl || '').trim()
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed)
    url.searchParams.set('utm_source', source)
    url.searchParams.set('utm_medium', medium)
    if (campaign) url.searchParams.set('utm_campaign', slugify(campaign))
    return url.toString()
  } catch {
    // Not a valid absolute URL — return as typed rather than throwing,
    // the composer shows a hint instead.
    return trimmed
  }
}

export function isValidUrl(value) {
  try {
    new URL(String(value || '').trim())
    return true
  } catch {
    return false
  }
}
