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
          <img src="/sdfm-logo.png" alt="SDFM Group" style={{ height: '22px', width: 'auto', filter: 'brightness(0) invert(1)' }} />
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
