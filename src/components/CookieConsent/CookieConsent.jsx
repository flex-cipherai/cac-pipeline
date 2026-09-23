import { useState, useEffect, useCallback } from 'react'
import './CookieConsent.css'

const STORAGE_KEY = 'sdfm_cookie_consent'
const LINKEDIN_PARTNER_ID = '10918017'
const PRIVACY_POLICY_URL = 'https://sdfmgroup.com/privacy-policy.html#cookies'

function getConsent() {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function setConsent(value) {
  try {
    window.localStorage.setItem(STORAGE_KEY, value)
  } catch {
    /* storage unavailable (private mode, blocked cookies) — consent re-asked next visit */
  }
}

function loadLinkedInInsightTag() {
  if (window._linkedInInsightLoaded) return
  window._linkedInInsightLoaded = true

  window._linkedin_partner_id = LINKEDIN_PARTNER_ID
  window._linkedin_data_partner_ids = window._linkedin_data_partner_ids || []
  window._linkedin_data_partner_ids.push(LINKEDIN_PARTNER_ID)

  ;(function (l) {
    if (!l) {
      window.lintrk = function (a, b) { window.lintrk.q.push([a, b]) }
      window.lintrk.q = []
    }
    const s = document.getElementsByTagName('script')[0]
    const b = document.createElement('script')
    b.type = 'text/javascript'
    b.async = true
    b.src = 'https://snap.licdn.com/li.lms-analytics/insight.min.js'
    s.parentNode.insertBefore(b, s)
  })(window.lintrk)

  const img = document.createElement('img')
  img.height = 1
  img.width = 1
  img.style.display = 'none'
  img.alt = ''
  img.src = `https://px.ads.linkedin.com/collect/?pid=${LINKEDIN_PARTNER_ID}&fmt=gif`
  document.body.appendChild(img)
}

// Gates the LinkedIn Insight Tag behind visitor consent. Only mount this on
// public-facing pages (e.g. /intake) — never on the authenticated CRM.
export default function CookieConsent() {
  const [bannerVisible, setBannerVisible] = useState(false)

  useEffect(() => {
    const consent = getConsent()
    if (consent === 'accepted') {
      loadLinkedInInsightTag()
    } else if (consent !== 'rejected') {
      setBannerVisible(true)
    }
  }, [])

  const handleAccept = useCallback(() => {
    setConsent('accepted')
    loadLinkedInInsightTag()
    setBannerVisible(false)
  }, [])

  const handleReject = useCallback(() => {
    setConsent('rejected')
    setBannerVisible(false)
  }, [])

  return (
    <>
      {bannerVisible && (
        <div className="cookie-banner" role="dialog" aria-label="Cookie consent">
          <p>
            We use cookies on this website. See our{' '}
            <a href={PRIVACY_POLICY_URL} target="_blank" rel="noopener noreferrer">cookie policy</a>{' '}
            to learn more.
          </p>
          <div className="cookie-banner-actions">
            <button type="button" className="cookie-btn-reject" onClick={handleReject}>Reject</button>
            <button type="button" className="cookie-btn-accept" onClick={handleAccept}>Accept</button>
          </div>
        </div>
      )}
      <button
        type="button"
        className="cookie-preferences-link"
        onClick={() => setBannerVisible(true)}
      >
        Cookie Preferences
      </button>
    </>
  )
}
