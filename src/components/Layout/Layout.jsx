import { useState } from 'react'
import Sidebar from './Sidebar'
import './Layout.css'

export default function Layout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="layout">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Mobile header */}
      <div className="mobile-header">
        <div className="mobile-header-logo">
          <svg width="24" height="24" viewBox="0 0 40 40">
            <circle cx="20" cy="20" r="18" fill="#EC3013" />
            <g transform="translate(12, 8)" fill="white">
              <circle cx="8" cy="3" r="2.5" />
              <rect x="6.5" y="5" width="3" height="14" rx="1.5" />
              <circle cx="2" cy="12" r="1.8" />
              <line x1="6.5" y1="12" x2="3.8" y2="12" stroke="white" strokeWidth="2" />
              <circle cx="14" cy="12" r="1.8" />
              <line x1="9.5" y1="12" x2="12.2" y2="12" stroke="white" strokeWidth="2" />
            </g>
          </svg>
          <span>PIPELINE</span>
        </div>
        <button
          className="mobile-hamburger"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open menu"
        >
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6" x2="19" y2="6" />
            <line x1="3" y1="11" x2="19" y2="11" />
            <line x1="3" y1="16" x2="19" y2="16" />
          </svg>
        </button>
      </div>

      <main className="layout-main">
        {children}
      </main>
    </div>
  )
}
