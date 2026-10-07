// Loads public/sdfm-tracker.js on public-facing pages (the Lead Intake Form)
// and exposes a tiny track() wrapper. The same script is what sdfmgroup.com
// installs, so a visit that starts on the marketing site continues here as
// one session — see the "Install tracker" panel on /social/website-analytics.
//
// Never call this from the authenticated CRM: staff activity is not website
// traffic.

const SCRIPT_ID = 'sdfm-tracker-script'

export function initTracker() {
  if (typeof document === 'undefined' || document.getElementById(SCRIPT_ID)) return
  const endpoint = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!endpoint || !key) return

  window.sdfmq = window.sdfmq || []
  const el = document.createElement('script')
  el.id = SCRIPT_ID
  el.async = true
  el.src = '/sdfm-tracker.js'
  el.setAttribute('data-endpoint', endpoint)
  el.setAttribute('data-key', key)
  document.head.appendChild(el)
}

// Safe before the script has loaded (events are queued and drained on load)
// and a no-op when tracking is disabled (bot, ?sdfm_ignore=1, blocked script).
export function track(type, props = {}) {
  if (typeof window === 'undefined') return
  try {
    if (window.sdfm && window.sdfm.track && window.sdfm.__loaded) {
      window.sdfm.track(type, props)
    } else {
      window.sdfmq = window.sdfmq || []
      window.sdfmq.push(['track', type, props])
    }
  } catch {
    /* analytics must never break the page */
  }
}

// The snippet to paste on sdfmgroup.com. Shown in Website Analytics.
export function getTrackerSnippet() {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://YOUR-APP-DOMAIN'
  const endpoint = import.meta.env.VITE_SUPABASE_URL || 'https://YOUR-PROJECT.supabase.co'
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY || 'YOUR-ANON-KEY'
  return `<script async src="${origin}/sdfm-tracker.js"\n        data-endpoint="${endpoint}"\n        data-key="${key}"></script>`
}
