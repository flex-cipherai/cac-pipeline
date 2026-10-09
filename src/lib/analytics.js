// The first-party tracker (public/sdfm-tracker.js) is installed on sdfmgroup.com,
// which now hosts the whole visitor journey including the booking page
// (sdfmgroup.com/book). This app is the CRM and the tracker's collector, so it
// never loads the tracker itself: staff activity is not website traffic.
//
// The only thing needed here is the snippet to paste on the website, shown on
// /social/website-analytics.

export function getTrackerSnippet() {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://YOUR-APP-DOMAIN'
  const endpoint = import.meta.env.VITE_SUPABASE_URL || 'https://YOUR-PROJECT.supabase.co'
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY || 'YOUR-ANON-KEY'
  return `<script async src="${origin}/sdfm-tracker.js"\n        data-endpoint="${endpoint}"\n        data-key="${key}"></script>`
}
