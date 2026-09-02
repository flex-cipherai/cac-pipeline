import './LeadIntakeForm.css'

export default function LeadIntakeForm() {
  return (
    <div className="intake-page">
      <div className="intake-container">
        {/* Logo */}
        <div className="intake-logo">
          <svg width="36" height="36" viewBox="0 0 40 40">
            <circle cx="20" cy="20" r="18" fill="#EC3013" />
            <g transform="translate(12, 8)" fill="white">
              <circle cx="8" cy="3" r="2.5" />
              <rect x="6.5" y="5" width="3" height="14" rx="1.5" />
              <circle cx="2" cy="12" r="1.8" />
              <line x1="6.5" y1="12" x2="3.8" y2="12" stroke="white" strokeWidth="2" />
              <circle cx="14" cy="12" r="1.8" />
              <line x1="9.5" y1="12" x2="12.2" y2="12" stroke="white" strokeWidth="2" />
              <circle cx="2" cy="17" r="1.8" />
              <line x1="6.5" y1="17" x2="3.8" y2="17" stroke="white" strokeWidth="2" />
              <circle cx="14" cy="17" r="1.8" />
              <line x1="9.5" y1="17" x2="12.2" y2="17" stroke="white" strokeWidth="2" />
            </g>
          </svg>
          <div className="intake-logo-text">
            <span style={{ fontSize: '1.1rem', fontWeight: 700, color: '#EC3013' }}>CIPHER AI</span>
            <span style={{ fontSize: '0.65rem', fontWeight: 600, color: '#201E1D', letterSpacing: '0.18em' }}>CONSULTANTS</span>
          </div>
        </div>

        <h1 className="intake-title">Book a Discovery Call</h1>
        <p className="intake-subtitle">Tell us about your business so we can prepare for our conversation.</p>

        <p style={{ color: 'var(--text-secondary)', textAlign: 'center', marginTop: '2rem' }}>
          Full intake form coming in Part 2.
        </p>
      </div>
    </div>
  )
}
