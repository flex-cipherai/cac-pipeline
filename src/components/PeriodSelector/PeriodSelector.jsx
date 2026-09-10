import { useState } from 'react'
import './PeriodSelector.css'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

export default function PeriodSelector({ value, onChange }) {
  // value = { mode: 'all' | 'month', month: 0-11, year: 2026 }
  const [showPicker, setShowPicker] = useState(false)

  const now = new Date()
  const currentMonth = now.getMonth()
  const currentYear = now.getFullYear()

  const isAllTime = value.mode === 'all'

  function navigateMonth(delta) {
    let m = value.month + delta
    let y = value.year
    if (m < 0) { m = 11; y-- }
    if (m > 11) { m = 0; y++ }
    // Don't go into the future
    if (y > currentYear || (y === currentYear && m > currentMonth)) return
    onChange({ mode: 'month', month: m, year: y })
  }

  function setAllTime() {
    onChange({ mode: 'all', month: currentMonth, year: currentYear })
    setShowPicker(false)
  }

  function pickMonth(m) {
    // Don't pick future months in the selected year
    if (value.year === currentYear && m > currentMonth) return
    onChange({ mode: 'month', month: m, year: value.year })
    setShowPicker(false)
  }

  function pickYear(y) {
    // When changing year, clamp month if needed
    let m = value.month
    if (y === currentYear && m > currentMonth) m = currentMonth
    onChange({ mode: 'month', month: m, year: y })
  }

  const canGoForward = !isAllTime && !(value.year === currentYear && value.month === currentMonth)

  // Build label
  const label = isAllTime
    ? 'All Time'
    : `${SHORT_MONTHS[value.month]} ${value.year}`

  return (
    <div className="period-selector">
      {/* Quick nav arrows */}
      {!isAllTime && (
        <button
          className="period-nav-btn"
          onClick={() => navigateMonth(-1)}
          aria-label="Previous month"
          type="button"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M9 2.5L4.5 7 9 11.5" /></svg>
        </button>
      )}

      {/* Main button */}
      <button
        className={`period-label-btn ${showPicker ? 'active' : ''}`}
        onClick={() => setShowPicker(!showPicker)}
        type="button"
        aria-expanded={showPicker}
      >
        <svg className="period-cal-icon" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
          <rect x="1.5" y="2.5" width="11" height="10" rx="1.5" />
          <path d="M1.5 5.5h11" />
          <path d="M4.5 1v2.5M9.5 1v2.5" />
        </svg>
        <span>{label}</span>
        <svg className={`period-chevron ${showPicker ? 'open' : ''}`} width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2.5 3.5L5 6.5 7.5 3.5" /></svg>
      </button>

      {!isAllTime && (
        <button
          className="period-nav-btn"
          onClick={() => navigateMonth(1)}
          disabled={!canGoForward}
          aria-label="Next month"
          type="button"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M5 2.5L9.5 7 5 11.5" /></svg>
        </button>
      )}

      {/* Dropdown picker */}
      {showPicker && (
        <>
          <div className="period-backdrop" onClick={() => setShowPicker(false)} />
          <div className="period-dropdown">
            <button
              className={`period-all-btn ${isAllTime ? 'active' : ''}`}
              onClick={setAllTime}
              type="button"
            >
              All Time
            </button>

            <div className="period-divider" />

            {/* Year selector */}
            <div className="period-year-row">
              <button
                className="period-year-nav"
                onClick={() => pickYear(value.year - 1)}
                type="button"
                aria-label="Previous year"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M7 1.5L3 5l4 3.5" /></svg>
              </button>
              <span className="period-year-label">{value.year}</span>
              <button
                className="period-year-nav"
                onClick={() => pickYear(value.year + 1)}
                disabled={value.year >= currentYear}
                type="button"
                aria-label="Next year"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 1.5L7 5l-4 3.5" /></svg>
              </button>
            </div>

            {/* Month grid */}
            <div className="period-month-grid">
              {SHORT_MONTHS.map((name, idx) => {
                const isFuture = value.year === currentYear && idx > currentMonth
                const isSelected = !isAllTime && value.month === idx
                return (
                  <button
                    key={idx}
                    className={`period-month-btn ${isSelected ? 'selected' : ''} ${isFuture ? 'disabled' : ''}`}
                    onClick={() => !isFuture && pickMonth(idx)}
                    disabled={isFuture}
                    type="button"
                  >
                    {name}
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// Helper: filter an array of items by period using a date field
export function filterByPeriod(items, period, dateField = 'created_at') {
  if (period.mode === 'all') return items
  return items.filter(item => {
    const d = new Date(item[dateField])
    return d.getMonth() === period.month && d.getFullYear() === period.year
  })
}

// Helper: get label for display
export function getPeriodLabel(period) {
  if (period.mode === 'all') return 'All Time'
  return `${MONTH_NAMES[period.month]} ${period.year}`
}
