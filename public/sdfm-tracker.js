/*!
 * SDFM first-party website tracker.
 *
 * Install on sdfmgroup.com (and any other page you want measured):
 *
 *   <script async src="https://YOUR-APP-DOMAIN/sdfm-tracker.js"
 *           data-endpoint="https://YOUR-PROJECT.supabase.co"
 *           data-key="YOUR-SUPABASE-ANON-KEY"></script>
 *
 * What it records: pageviews, time on page, scroll depth, link/button clicks
 * (label only), outbound links, downloads, site form submissions, and any
 * custom events sent through window.sdfm.track(). The Lead Intake Form uses
 * the same API for its funnel events.
 *
 * Privacy ("hybrid consent")
 *   - Always: anonymous sessions. The session id lives in sessionStorage and
 *     dies with the tab; no IP is stored; query strings other than utm_* are
 *     never sent.
 *   - Only after the visitor accepts cookies (localStorage[data-consent-key]
 *     === 'accepted') AND sends no Do-Not-Track / Global-Privacy-Control
 *     signal: a random visitor id is kept in localStorage to count returning
 *     visitors.
 *   - Reject, DNT or GPC removes any stored visitor id.
 *
 * Optional attributes:  data-consent-key (default "sdfm_cookie_consent").
 * Internal traffic:     visit any page with ?sdfm_ignore=1 to exclude that
 *                       browser; ?sdfm_ignore=0 to include it again.
 * Custom CTA:           add data-sdfm-cta to a link, data-sdfm-label to name
 *                       any element, data-sdfm-ignore to exclude a region.
 */
(function () {
  'use strict'

  var win = window
  var doc = document
  if (win.sdfm && win.sdfm.__loaded) return

  // ── API shell (no-ops until / unless tracking is enabled) ──
  var api = {
    __loaded: true,
    track: function () {},
    setConsent: function () {},
    sessionId: function () { return null },
    flush: function () {},
  }
  win.sdfm = api

  var script = doc.currentScript || doc.querySelector('script[data-endpoint][src*="sdfm-tracker"]')
  if (!script) return

  var ENDPOINT = (script.getAttribute('data-endpoint') || '').replace(/\/+$/, '')
  var KEY = script.getAttribute('data-key') || ''
  var CONSENT_KEY = script.getAttribute('data-consent-key') || 'sdfm_cookie_consent'
  if (!ENDPOINT || !KEY) return

  var APP_HOST = ''
  try { APP_HOST = new URL(script.src, win.location.href).host } catch (e) { /* ignore */ }

  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  var BOT_RE = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|facebookexternalhit|phantomjs/i
  var SESSION_TTL = 30 * 60 * 1000
  var IDLE_MS = 30 * 1000
  var FLUSH_DELAY = 1500
  var MAX_QUEUE = 100
  var MAX_TRIES = 3
  var DOWNLOAD_RE = /\.(pdf|docx?|xlsx?|pptx?|csv|zip|rar)$/i

  // ── Safe storage (private mode / blocked storage must never break a page) ──
  function store(kind) {
    return {
      get: function (k) { try { return win[kind].getItem(k) } catch (e) { return null } },
      set: function (k, v) { try { win[kind].setItem(k, v) } catch (e) { /* ignore */ } },
      del: function (k) { try { win[kind].removeItem(k) } catch (e) { /* ignore */ } },
    }
  }
  var local = store('localStorage')
  var session = store('sessionStorage')

  // ── URL params: internal-traffic switch + cross-domain hand-off ──
  var params = new URLSearchParams(win.location.search)
  var ignoreParam = params.get('sdfm_ignore')
  if (ignoreParam === '1') local.set('sdfm_ignore', '1')
  if (ignoreParam === '0') local.del('sdfm_ignore')

  var adoptedSid = params.get('sdfm_sid')
  var adoptedVid = params.get('sdfm_vid')
  if (adoptedSid && !UUID_RE.test(adoptedSid)) adoptedSid = null
  if (adoptedVid && !UUID_RE.test(adoptedVid)) adoptedVid = null

  // Remove our own params from the address bar so they are never shared or
  // bookmarked, without adding a history entry.
  if (adoptedSid || adoptedVid || ignoreParam !== null) {
    try {
      var clean = new URL(win.location.href)
      clean.searchParams.delete('sdfm_sid')
      clean.searchParams.delete('sdfm_vid')
      clean.searchParams.delete('sdfm_ignore')
      win.history.replaceState(win.history.state, '', clean.pathname + clean.search + clean.hash)
    } catch (e) { /* ignore */ }
  }

  if (local.get('sdfm_ignore') === '1') return
  if (win.location.protocol === 'file:') return
  if (navigator.webdriver || BOT_RE.test(navigator.userAgent || '')) return

  // ── Helpers ──
  function uuid() {
    if (win.crypto && win.crypto.randomUUID) return win.crypto.randomUUID()
    var b = new Uint8Array(16)
    if (win.crypto && win.crypto.getRandomValues) win.crypto.getRandomValues(b)
    else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
    b[6] = (b[6] & 0x0f) | 0x40
    b[8] = (b[8] & 0x3f) | 0x80
    var h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2) }).join('')
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20)
  }

  function eventId() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36) }

  function cut(v, n) { return String(v == null ? '' : v).slice(0, n) }

  function normPath(p) {
    p = p || '/'
    if (p.length > 1) p = p.replace(/\/+$/, '')
    return cut(p || '/', 300)
  }

  function privacySignal() {
    return navigator.doNotTrack === '1' || win.doNotTrack === '1' || navigator.globalPrivacyControl === true
  }

  function canIdentify() { return local.get(CONSENT_KEY) === 'accepted' && !privacySignal() }

  function deviceInfo() {
    var ua = navigator.userAgent || ''
    var device = 'desktop'
    if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) device = 'tablet'
    else if (/Mobi|iPhone|iPod|Android/i.test(ua)) device = 'mobile'

    var browser = 'Other'
    if (/SamsungBrowser/i.test(ua)) browser = 'Samsung Internet'
    else if (/Edg\//.test(ua)) browser = 'Edge'
    else if (/OPR\/|Opera/.test(ua)) browser = 'Opera'
    else if (/Firefox|FxiOS/.test(ua)) browser = 'Firefox'
    else if (/Chrome|CriOS/.test(ua)) browser = 'Chrome'
    else if (/Safari/.test(ua)) browser = 'Safari'

    var os = 'Other'
    if (/Windows/.test(ua)) os = 'Windows'
    else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS'
    else if (/Android/.test(ua)) os = 'Android'
    else if (/Mac OS X/.test(ua)) os = 'macOS'
    else if (/CrOS/.test(ua)) os = 'ChromeOS'
    else if (/Linux/.test(ua)) os = 'Linux'

    return { device_type: device, browser: browser, os: os }
  }

  // ── Visitor + session state ──
  var vid = null
  var sess = null

  function readSession() {
    try { return JSON.parse(session.get('sdfm_s') || 'null') } catch (e) { return null }
  }

  function saveSession() { sess.last = Date.now(); session.set('sdfm_s', JSON.stringify(sess)) }

  function buildContext() {
    var ref = ''
    try {
      var r = new URL(doc.referrer)
      if (r.host !== win.location.host) ref = r.origin + r.pathname
    } catch (e) { /* no / invalid referrer */ }

    var env = deviceInfo()
    var tz = ''
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '' } catch (e) { /* ignore */ }

    return {
      host: win.location.host,
      landing_path: normPath(win.location.pathname),
      referrer: ref,
      utm_source: cut(params.get('utm_source'), 100),
      utm_medium: cut(params.get('utm_medium'), 100),
      utm_campaign: cut(params.get('utm_campaign'), 150),
      utm_term: cut(params.get('utm_term'), 150),
      utm_content: cut(params.get('utm_content'), 150),
      device_type: env.device_type,
      browser: env.browser,
      os: env.os,
      language: cut(navigator.language, 20),
      timezone: cut(tz, 60),
      viewport_w: win.innerWidth || 0,
    }
  }

  function initSession() {
    var s = readSession()
    var now = Date.now()
    if (adoptedSid && (!s || s.id !== adoptedSid)) {
      // Continuing a visit that started on another of our domains.
      s = { id: adoptedSid, ctx: null, last: now, vnew: false }
    } else if (!s || !s.id || now - s.last > SESSION_TTL) {
      s = { id: uuid(), ctx: null, last: now, vnew: false }
    }
    if (!s.ctx) s.ctx = buildContext()
    sess = s
    refreshVisitor()
    saveSession()
  }

  // Visitor id exists only with consent. Called at start and whenever consent changes.
  function refreshVisitor() {
    if (!canIdentify()) {
      vid = null
      if (local.get(CONSENT_KEY) === 'rejected' || privacySignal()) local.del('sdfm_vid')
      return
    }
    var v = local.get('sdfm_vid')
    if (!v || !UUID_RE.test(v)) {
      v = adoptedVid || uuid()
      local.set('sdfm_vid', v)
      sess.vnew = true
    }
    vid = v
  }

  function sessionPayload() {
    var c = sess.ctx || {}
    var out = {
      id: sess.id,
      consented: !!vid,
      visitor_id: vid || '',
      is_returning: !!vid && !sess.vnew,
    }
    for (var k in c) if (Object.prototype.hasOwnProperty.call(c, k)) out[k] = c[k]
    return out
  }

  // ── Queue + transport ──
  var queue = []
  var timer = null
  var sessionDirty = false

  function schedule() {
    if (timer) return
    timer = setTimeout(function () { timer = null; flush(false) }, FLUSH_DELAY)
  }

  function cleanProps(props) {
    var out = {}
    var n = 0
    if (!props || typeof props !== 'object') return out
    for (var k in props) {
      if (!Object.prototype.hasOwnProperty.call(props, k) || n >= 20) continue
      var v = props[k]
      if (typeof v === 'string') out[cut(k, 40)] = cut(v, 200)
      else if (typeof v === 'number' && isFinite(v)) out[cut(k, 40)] = v
      else if (typeof v === 'boolean') out[cut(k, 40)] = v
      else continue
      n++
    }
    return out
  }

  function push(type, props, path) {
    queue.push({
      eid: eventId(),
      type: type,
      host: win.location.host,
      path: path || normPath(win.location.pathname),
      title: cut(doc.title, 120),
      props: cleanProps(props),
      t: Date.now(),
      tries: 0,
    })
    if (queue.length > MAX_QUEUE) queue.shift()
    schedule()
  }

  function send(batch, final) {
    var now = Date.now()
    var body = JSON.stringify({
      payload: {
        session: sessionPayload(),
        events: batch.map(function (e) {
          return { eid: e.eid, type: e.type, host: e.host, path: e.path, title: e.title, props: e.props, age_ms: Math.max(0, now - e.t) }
        }),
      },
    })
    var req = fetch(ENDPOINT + '/rest/v1/rpc/track_web_batch', {
      method: 'POST',
      keepalive: body.length < 60000,
      headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: 'Bearer ' + KEY },
      body: body,
    })
    req.then(function (res) {
      // 4xx means the payload itself is rejected — retrying cannot help.
      if (res && res.status >= 500 && !final) requeue(batch)
    }, function () {
      if (!final) requeue(batch)
    })
  }

  function requeue(batch) {
    var retry = batch.filter(function (e) { return ++e.tries < MAX_TRIES })
    queue = retry.concat(queue).slice(-MAX_QUEUE)
    if (retry.length) setTimeout(function () { flush(false) }, 5000)
  }

  function flush(final) {
    if (!sess) return
    if (timer) { clearTimeout(timer); timer = null }
    if (!queue.length && !sessionDirty) return
    sessionDirty = false
    saveSession()
    do {
      send(queue.splice(0, 50), final)
    } while (queue.length)
  }

  // ── Engagement (time on page, scroll depth) ──
  var engaged = 0
  var maxScroll = 0
  var sentScroll = 0
  var lastActive = Date.now()
  var visible = doc.visibilityState !== 'hidden'
  var currentPath = null

  function measureScroll() {
    var h = doc.documentElement
    var total = Math.max(h.scrollHeight || 0, doc.body ? doc.body.scrollHeight : 0)
    var pos = (win.pageYOffset || h.scrollTop || 0) + (win.innerHeight || 0)
    var pct = total > 0 ? Math.min(100, Math.round((pos / total) * 100)) : 0
    if (pct > maxScroll) maxScroll = pct
  }

  function markActive() { lastActive = Date.now() }

  function startPage() {
    currentPath = normPath(win.location.pathname)
    engaged = 0
    maxScroll = 0
    sentScroll = 0
    measureScroll()
    push('pageview', {}, currentPath)
  }

  // Sent whenever the page is hidden / left. engaged_ms is a delta since the
  // last page_leave (the server sums them); max_scroll is the running maximum.
  // Skipped when nothing new happened, e.g. pagehide right after hidden.
  function endPage() {
    if (!currentPath) return
    if (engaged > 0 || maxScroll > sentScroll) {
      push('page_leave', { engaged_ms: Math.round(engaged), max_scroll: maxScroll }, currentPath)
      sentScroll = maxScroll
    }
    engaged = 0
  }

  // ── Click / form capture ──
  function labelOf(el) {
    var raw = el.getAttribute('data-sdfm-label') || el.getAttribute('aria-label') || el.innerText || el.textContent || el.title || ''
    raw = String(raw).replace(/\s+/g, ' ').trim()
    if (raw.indexOf('@') !== -1) return '[redacted]'
    return cut(raw, 80)
  }

  // Carry the session over when a link leaves for our other domain (e.g. the
  // marketing site -> the Lead Intake Form) so the whole journey is one visit.
  function decorate(a) {
    if (!APP_HOST) return
    try {
      var u = new URL(a.href, win.location.href)
      if (!/^https?:$/.test(u.protocol) || u.host !== APP_HOST || u.host === win.location.host) return
      u.searchParams.set('sdfm_sid', sess.id)
      if (vid) u.searchParams.set('sdfm_vid', vid)
      a.href = u.toString()
    } catch (e) { /* ignore */ }
  }

  function trackLink(a) {
    var u
    try { u = new URL(a.href, win.location.href) } catch (e) { return }
    var label = labelOf(a)

    if (u.protocol === 'mailto:' || u.protocol === 'tel:') {
      push('click', { kind: u.protocol.slice(0, -1), label: label || u.protocol.slice(0, -1) })
      return
    }
    if (!/^https?:$/.test(u.protocol)) return

    var target = u.host + normPath(u.pathname)
    var toApp = APP_HOST && u.host === APP_HOST && u.host !== win.location.host

    if (a.hasAttribute('data-sdfm-cta') || toApp) {
      push('cta_click', { label: label, href: target })
      flush(true)
    } else if (DOWNLOAD_RE.test(u.pathname)) {
      push('download', { label: label || u.pathname.split('/').pop(), href: target })
      flush(true)
    } else if (u.host !== win.location.host) {
      push('outbound', { label: label || u.host, href: target })
      flush(true)
    } else {
      push('click', { kind: 'link', label: label, href: target })
    }
  }

  function onClick(e) {
    var t = e.target
    var el = t && t.closest ? t.closest('a[href],button,[data-sdfm-event],[role="button"]') : null
    if (!el || el.closest('[data-sdfm-ignore]') || el.disabled) return
    if (el.tagName === 'A') {
      decorate(el)
      trackLink(el)
    } else {
      push('click', { kind: 'button', label: labelOf(el) })
    }
  }

  function onSubmit(e) {
    var f = e.target
    if (!f || f.tagName !== 'FORM' || f.closest('[data-sdfm-ignore]')) return
    var action = ''
    try { action = normPath(new URL(f.getAttribute('action') || win.location.href, win.location.href).pathname) } catch (err) { /* ignore */ }
    push('site_form_submit', { label: f.getAttribute('data-sdfm-label') || f.id || f.getAttribute('name') || 'form', href: action })
    flush(true)
  }

  // ── Consent changes ──
  function consentChanged() {
    if (!sess) return
    refreshVisitor()
    saveSession()
    sessionDirty = true // upgrade (or keep anonymous) on the server
    schedule()
  }

  // ── Public API ──
  function normType(type) {
    var t = String(type || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
    return /^[a-z]/.test(t) ? t : ''
  }

  api.track = function (type, props) {
    var t = normType(type)
    if (!t || !sess) return
    push(t, props)
    // Conversions must not be lost to a page change.
    if (t === 'form_submit') flush(true)
  }
  api.setConsent = function (value) {
    if (value === 'accepted' || value === 'rejected') local.set(CONSENT_KEY, value)
    consentChanged()
  }
  api.sessionId = function () { return sess && sess.id }
  api.flush = function () { flush(true) }

  // ── Boot ──
  initSession()

  doc.addEventListener('click', onClick, true)
  doc.addEventListener('auxclick', onClick, true)
  doc.addEventListener('submit', onSubmit, true)
  win.addEventListener('scroll', measureScroll, { passive: true })
  ;['mousemove', 'keydown', 'touchstart', 'scroll', 'click'].forEach(function (name) {
    win.addEventListener(name, markActive, { passive: true, capture: true })
  })
  win.addEventListener('sdfm:consent', consentChanged)

  setInterval(function () {
    if (visible && Date.now() - lastActive < IDLE_MS) engaged += 1000
  }, 1000)

  doc.addEventListener('visibilitychange', function () {
    visible = doc.visibilityState !== 'hidden'
    if (!visible) { endPage(); flush(true) } else { markActive() }
  })
  win.addEventListener('pagehide', function () { endPage(); flush(true) })
  win.addEventListener('pageshow', function (e) {
    // Back/forward cache restore is a fresh view of the page.
    if (e.persisted) { initSession(); startPage() }
  })

  // Single-page apps: count each route change as its own pageview.
  function onRouteChange() {
    var p = normPath(win.location.pathname)
    if (!currentPath || p === currentPath) return
    endPage()
    startPage()
  }
  ;['pushState', 'replaceState'].forEach(function (fn) {
    var orig = win.history[fn]
    win.history[fn] = function () {
      var r = orig.apply(this, arguments)
      onRouteChange()
      return r
    }
  })
  win.addEventListener('popstate', onRouteChange)

  // Drain events queued by code that ran before this script loaded.
  var early = win.sdfmq
  win.sdfmq = { push: function (item) { if (item && item[0] === 'track') api.track(item[1], item[2]) } }
  if (early && early.length) early.forEach(function (item) { win.sdfmq.push(item) })

  if (doc.prerendering) {
    doc.addEventListener('prerenderingchange', startPage, { once: true })
  } else {
    startPage()
  }
})()
