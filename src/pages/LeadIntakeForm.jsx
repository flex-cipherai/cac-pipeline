import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { QUALIFICATION_QUESTIONS, DAYS_OF_WEEK, scoreLead } from '../lib/scoring'
import './LeadIntakeForm.css'

const STEPS = [
  { key: 'contact', label: 'Contact Details' },
  { key: 'qualification', label: 'Qualification' },
  { key: 'schedule', label: 'Schedule Call' },
]

const SDFM_LOGO = (
  <img src="/sdfm-logo.png" alt="SDFM Group Limited" className="intake-logo-img" />
)

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAY_LABELS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

// Default booking config
const DEFAULT_CONFIG = {
  booking_window_days: 14,
  booking_min_notice_hours: 4,
  booking_duration_minutes: 60,
  booking_buffer_minutes: 0,
}

export default function LeadIntakeForm() {
  const [step, setStep] = useState(1)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitResult, setSubmitResult] = useState(null)

  // Contact details
  const [contact, setContact] = useState({
    full_name: '', company_name: '', email: '', phone: '', has_whatsapp: false,
  })

  // Qualification responses
  const [responses, setResponses] = useState({ q1: '', q2: '', q3: '', q4: '', q5: '' })

  // Calendar state
  const [availability, setAvailability] = useState({}) // { dayOfWeek: [time, ...] }
  const [bookedSlots, setBookedSlots] = useState([])
  const [bookingConfig, setBookingConfig] = useState(DEFAULT_CONFIG)
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [calMonth, setCalMonth] = useState(new Date().getMonth())
  const [calYear, setCalYear] = useState(new Date().getFullYear())
  const [selectedDate, setSelectedDate] = useState(null)
  const [selectedTime, setSelectedTime] = useState(null)

  // Source tracking via URL param
  const [source, setSource] = useState('Website')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const src = params.get('source')
    if (src) setSource(src)
  }, [])

  // Fetch availability + booking config when reaching step 3
  useEffect(() => {
    if (step === 3) fetchAvailability()
  }, [step])

  async function fetchAvailability() {
    setLoadingSlots(true)
    try {
      const [slotsRes, bookedRes, configRes] = await Promise.all([
        supabase.from('calendar_availability').select('*').eq('is_available', true).order('day_of_week').order('time_slot'),
        supabase.from('booked_slots').select('*'),
        supabase.from('system_settings').select('key, value').in('key', [
          'booking_window_days', 'booking_min_notice_hours', 'booking_duration_minutes', 'booking_buffer_minutes'
        ]),
      ])

      // Group available slots by day of week
      const grouped = {}
      if (slotsRes.data) {
        slotsRes.data.forEach(slot => {
          if (!grouped[slot.day_of_week]) grouped[slot.day_of_week] = []
          grouped[slot.day_of_week].push(slot.time_slot)
        })
      }
      setAvailability(grouped)
      setBookedSlots(bookedRes.data || [])

      // Parse booking config
      if (configRes.data) {
        const cfg = { ...DEFAULT_CONFIG }
        configRes.data.forEach(row => {
          if (row.key && row.value) cfg[row.key] = parseInt(row.value, 10)
        })
        setBookingConfig(cfg)
      }
    } catch (err) {
      console.error('Error fetching availability:', err)
    } finally {
      setLoadingSlots(false)
    }
  }

  // ── Calendar helpers ──
  function getDaysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate()
  }

  function getFirstDayOfMonth(year, month) {
    const d = new Date(year, month, 1).getDay()
    return d === 0 ? 6 : d - 1 // Convert Sun=0 → 6, Mon=1 → 0
  }

  function getJsDayOfWeek(date) {
    // Our system: 1=Mon, 2=Tue ... 5=Fri
    const d = date.getDay()
    return d === 0 ? 7 : d // Sun=7, Mon=1 ... Sat=6
  }

  function isDateAvailable(date) {
    const dow = getJsDayOfWeek(date)
    if (dow > 5) return false // Weekend
    if (!availability[dow] || availability[dow].length === 0) return false

    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate())

    // Must be in the future
    if (dateOnly < today) return false

    // Must be within booking window
    const maxDate = new Date(today)
    maxDate.setDate(maxDate.getDate() + bookingConfig.booking_window_days)
    if (dateOnly > maxDate) return false

    // Check if there are any open slots on this date (not all booked)
    const openSlots = getOpenSlotsForDate(date)
    return openSlots.length > 0
  }

  function getOpenSlotsForDate(date) {
    const dow = getJsDayOfWeek(date)
    const slots = availability[dow] || []
    const dateStr = formatDateStr(date)

    return slots.filter(time => {
      // Check if booked
      const isBooked = bookedSlots.some(b => b.slot_date === dateStr && b.time_slot === time)
      if (isBooked) return false

      // Check buffer: is the previous slot booked and buffer applies?
      if (bookingConfig.booking_buffer_minutes > 0) {
        const prevHour = parseInt(time.split(':')[0], 10) - 1
        const prevTime = `${String(prevHour).padStart(2, '0')}:00`
        const prevBooked = bookedSlots.some(b => b.slot_date === dateStr && b.time_slot === prevTime)
        if (prevBooked && bookingConfig.booking_buffer_minutes >= 30) return false
      }

      // Check minimum notice
      const now = new Date()
      const slotDateTime = new Date(`${dateStr}T${time}:00`)
      const hoursUntil = (slotDateTime - now) / 3600000
      if (hoursUntil < bookingConfig.booking_min_notice_hours) return false

      return true
    })
  }

  function formatDateStr(date) {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  function formatDateDisplay(date) {
    return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  }

  function formatDateShort(date) {
    return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  }

  function navigateMonth(dir) {
    let newMonth = calMonth + dir
    let newYear = calYear
    if (newMonth < 0) { newMonth = 11; newYear-- }
    if (newMonth > 11) { newMonth = 0; newYear++ }
    setCalMonth(newMonth)
    setCalYear(newYear)
  }

  function handleSelectDate(date) {
    setSelectedDate(date)
    setSelectedTime(null) // Reset time when date changes
  }

  // ── Validation ──
  function isStep1Valid() {
    return contact.full_name.trim() && contact.company_name.trim() && contact.email.trim() && contact.phone.trim()
  }

  function isStep2Valid() {
    return responses.q1 && responses.q2 && responses.q3 && responses.q4 && responses.q5
  }

  function isStep3Valid() {
    return selectedDate !== null && selectedTime !== null
  }

  function goNext() { if (step < 3) setStep(step + 1) }
  function goBack() { if (step > 1) setStep(step - 1) }

  // ── Submit ──
  async function handleSubmit() {
    if (!isStep3Valid()) return
    setSubmitting(true)

    try {
      const scoreResult = scoreLead(responses)
      const q1Option = QUALIFICATION_QUESTIONS.q1.options.find(o => o.value === responses.q1)
      const q2Option = QUALIFICATION_QUESTIONS.q2.options.find(o => o.value === responses.q2)
      const q3Option = QUALIFICATION_QUESTIONS.q3.options.find(o => o.value === responses.q3)
      const q4Option = QUALIFICATION_QUESTIONS.q4.options.find(o => o.value === responses.q4)
      const q5Option = QUALIFICATION_QUESTIONS.q5.options.find(o => o.value === responses.q5)

      const scheduledDateStr = formatDateStr(selectedDate)
      const dayLabel = formatDateShort(selectedDate)
      const isQualified = scoreResult.classification !== 'cold'
      const initialStage = isQualified ? 'Scheduled' : 'Disqualified'
      const dayOfWeek = getJsDayOfWeek(selectedDate)

      const { data: lead, error: leadError } = await supabase
        .from('leads')
        .insert({
          ...contact,
          q1_revenue: q1Option?.label,
          q2_challenge: q2Option?.label,
          q3_role: q3Option?.label,
          q4_priority: q4Option?.label,
          q5_timeline: q5Option?.label,
          ...scoreResult,
          current_stage: initialStage,
          scheduled_day: dayLabel,
          scheduled_time: selectedTime,
          scheduled_date: scheduledDateStr,
          source,
        })
        .select()
        .single()

      if (leadError) throw leadError

      if (isQualified) {
        await supabase.from('booked_slots').insert({
          lead_id: lead.id,
          slot_date: scheduledDateStr,
          time_slot: selectedTime,
          day_of_week: dayOfWeek,
        })
        await supabase.from('lead_stage_history').insert({
          lead_id: lead.id,
          stage: 'Scheduled',
        })
      }

      setSubmitResult({
        qualified: isQualified,
        classification: scoreResult.classification,
        scheduledDay: dayLabel,
        scheduledTime: selectedTime,
        scheduledDate: selectedDate,
      })
      setSubmitted(true)
    } catch (err) {
      console.error('Submission error:', err)
      alert('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Render calendar grid ──
  function renderCalendar() {
    const daysInMonth = getDaysInMonth(calYear, calMonth)
    const firstDay = getFirstDayOfMonth(calYear, calMonth)
    const cells = []

    // Empty cells before first day
    for (let i = 0; i < firstDay; i++) {
      cells.push(<div key={`empty-${i}`} className="cal-cell cal-cell-empty" />)
    }

    // Day cells
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(calYear, calMonth, day)
      const available = isDateAvailable(date)
      const isSelected = selectedDate && formatDateStr(selectedDate) === formatDateStr(date)
      const isToday = formatDateStr(new Date()) === formatDateStr(date)

      cells.push(
        <button
          key={day}
          className={`cal-cell cal-day ${available ? 'available' : 'disabled'} ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''}`}
          onClick={() => available && handleSelectDate(date)}
          disabled={!available}
          type="button"
        >
          {day}
        </button>
      )
    }

    return cells
  }

  // ── Confirmation screen ──
  if (submitted && submitResult) {
    return (
      <div className="intake-page">
        <div className="intake-container">
          <div className="intake-logo">
            {SDFM_LOGO}
          </div>
          <div className="intake-confirmation">
            {submitResult.qualified ? (
              <>
                <div className="intake-confirm-icon">✓</div>
                <h1 className="intake-title">You're All Set</h1>
                <p className="intake-subtitle">
                  Your discovery call is confirmed for{' '}
                  <strong>{submitResult.scheduledDay}</strong> at{' '}
                  <strong>{submitResult.scheduledTime}</strong>.
                </p>
                <p className="intake-confirm-detail">
                  You'll receive a confirmation email shortly.
                  During the call, we'll discuss your business challenges and
                  explore how AI solutions can help.
                </p>
              </>
            ) : (
              <>
                <div className="intake-confirm-icon-muted">
                  <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M14 8v8M14 20v.5" /></svg>
                </div>
                <h1 className="intake-title">Thank You</h1>
                <p className="intake-subtitle">
                  We appreciate you taking the time to tell us about your business.
                </p>
                <p className="intake-confirm-detail">
                  Based on the information you provided, our services may not be
                  the right fit at this time. As your needs evolve, we'd welcome
                  the chance to reconnect.
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── Main form ──
  return (
    <div className="intake-page">
      <div className="intake-container">
        <div className="intake-logo">
          {SDFM_LOGO}
        </div>

        <h1 className="intake-title">Book a Discovery Call</h1>
        <p className="intake-subtitle">
          Tell us about your business so we can prepare for our conversation.
        </p>

        {/* Step indicator */}
        <div className="intake-steps" data-step={step}>
          {STEPS.map((s, i) => (
            <div key={s.key} className={`intake-step-tab ${step === i + 1 ? 'active' : ''} ${step > i + 1 ? 'completed' : ''}`}>
              {s.label}
            </div>
          ))}
        </div>

        {/* Step 1: Contact Details */}
        {step === 1 && (
          <div className="intake-step-content">
            <h2 className="intake-section-title">Your Contact Details</h2>
            <div className="form-group">
              <label className="form-label" htmlFor="full_name">Full Name</label>
              <input id="full_name" type="text" className="form-input" placeholder="Full Name" value={contact.full_name} onChange={e => setContact({ ...contact, full_name: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="company_name">Company Name</label>
              <input id="company_name" type="text" className="form-input" placeholder="Company Name" value={contact.company_name} onChange={e => setContact({ ...contact, company_name: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="email">Email Address</label>
              <input id="email" type="email" className="form-input" placeholder="Email Address" value={contact.email} onChange={e => setContact({ ...contact, email: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="phone">Phone Number</label>
              <input id="phone" type="tel" className="form-input" placeholder="Phone Number" value={contact.phone} onChange={e => setContact({ ...contact, phone: e.target.value })} />
            </div>
            <div className="intake-nav">
              <button className="btn btn-primary" onClick={goNext} disabled={!isStep1Valid()}>Continue →</button>
            </div>
          </div>
        )}

        {/* Step 2: Qualification Questions */}
        {step === 2 && (
          <div className="intake-step-content">
            <h2 className="intake-section-title">Qualification Questions</h2>
            {Object.entries(QUALIFICATION_QUESTIONS).map(([key, question], idx) => (
              <div key={key} className="intake-question">
                <p className="intake-question-label">
                  <span className="intake-question-number">{idx + 1}</span>
                  {question.question}
                </p>
                <div className="radio-group">
                  {question.options.map(option => (
                    <div key={option.value} className={`radio-option ${responses[key] === option.value ? 'selected' : ''}`} onClick={() => setResponses({ ...responses, [key]: option.value })}>
                      <input type="radio" name={key} value={option.value} checked={responses[key] === option.value} readOnly />
                      <label>{option.label}</label>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div className="intake-nav">
              <button className="btn btn-secondary" onClick={goBack}>← Back</button>
              <button className="btn btn-primary" onClick={goNext} disabled={!isStep2Valid()}>Continue →</button>
            </div>
          </div>
        )}

        {/* Step 3: Schedule Call — Calendly-style */}
        {step === 3 && (
          <div className="intake-step-content">
            <h2 className="intake-section-title">Schedule Your Discovery Call</h2>
            <p className="intake-schedule-subtitle">
              Pick a date, then choose a time.
              {bookingConfig.booking_duration_minutes && (
                <span className="intake-duration-note"> Calls are {bookingConfig.booking_duration_minutes} minutes.</span>
              )}
            </p>

            {loadingSlots ? (
              <div className="cal-loading">
                <div className="skeleton" style={{ width: '100%', height: 300, borderRadius: 'var(--radius-md)' }} />
              </div>
            ) : (
              <div className="cal-layout">
                {/* Calendar */}
                <div className="cal-panel">
                  <div className="cal-header">
                    <button className="cal-nav-btn" onClick={() => navigateMonth(-1)} type="button" aria-label="Previous month">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M10 3L5 8l5 5" /></svg>
                    </button>
                    <span className="cal-month-label">{MONTH_NAMES[calMonth]} {calYear}</span>
                    <button className="cal-nav-btn" onClick={() => navigateMonth(1)} type="button" aria-label="Next month">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M6 3l5 5-5 5" /></svg>
                    </button>
                  </div>
                  <div className="cal-grid">
                    {DAY_LABELS.map(d => <div key={d} className="cal-cell cal-day-label">{d}</div>)}
                    {renderCalendar()}
                  </div>
                  <div className="cal-legend">
                    <span className="cal-legend-item"><span className="cal-legend-dot available" /> Available</span>
                    <span className="cal-legend-item"><span className="cal-legend-dot selected" /> Selected</span>
                  </div>
                </div>

                {/* Time slots */}
                <div className="cal-times-panel">
                  {selectedDate ? (
                    <>
                      <div className="cal-times-header">{formatDateDisplay(selectedDate)}</div>
                      {(() => {
                        const openSlots = getOpenSlotsForDate(selectedDate)
                        if (openSlots.length === 0) {
                          return <p className="cal-times-empty">No available times on this date.</p>
                        }
                        return (
                          <div className="cal-times-list">
                            {openSlots.map(time => (
                              <button
                                key={time}
                                type="button"
                                className={`cal-time-slot ${selectedTime === time ? 'selected' : ''}`}
                                onClick={() => setSelectedTime(time)}
                              >
                                <span className="cal-time-slot-time">{time}</span>
                                <span className="cal-time-slot-dur">{bookingConfig.booking_duration_minutes} min</span>
                              </button>
                            ))}
                          </div>
                        )
                      })()}
                    </>
                  ) : (
                    <div className="cal-times-placeholder">
                      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                        <rect x="4" y="6" width="24" height="22" rx="2" />
                        <path d="M4 12h24" />
                        <path d="M10 3v5M22 3v5" />
                      </svg>
                      <p>Select a date to see available times</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Selected summary */}
            {selectedDate && selectedTime && (
              <div className="cal-selection-summary">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="8" cy="8" r="6" /><path d="M8 4.5V8l2.5 1.5" /></svg>
                <span>{formatDateShort(selectedDate)} at {selectedTime} ({bookingConfig.booking_duration_minutes} min)</span>
              </div>
            )}

            <div className="intake-nav">
              <button className="btn btn-secondary" onClick={goBack}>← Back</button>
              <button className="btn btn-primary" onClick={handleSubmit} disabled={!isStep3Valid() || submitting}>
                {submitting ? 'Submitting...' : 'Book Discovery Call'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
