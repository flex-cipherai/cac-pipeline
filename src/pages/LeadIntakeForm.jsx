import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { QUALIFICATION_QUESTIONS, DAYS_OF_WEEK, scoreLead } from '../lib/scoring'
import './LeadIntakeForm.css'

const STEPS = [
  { key: 'contact', label: 'Contact Details' },
  { key: 'qualification', label: 'Qualification' },
  { key: 'schedule', label: 'Schedule Call' },
]

const CAC_LOGO = (
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
)

export default function LeadIntakeForm() {
  const [step, setStep] = useState(1)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitResult, setSubmitResult] = useState(null)

  // Contact details
  const [contact, setContact] = useState({
    full_name: '',
    company_name: '',
    email: '',
    phone: '',
    has_whatsapp: false,
  })

  // Qualification responses
  const [responses, setResponses] = useState({
    q1: '',
    q2: '',
    q3: '',
    q4: '',
    q5: '',
  })

  // Schedule
  const [availability, setAvailability] = useState({})
  const [bookedSlots, setBookedSlots] = useState([])
  const [selectedSlot, setSelectedSlot] = useState(null)
  const [loadingSlots, setLoadingSlots] = useState(false)

  // Source tracking via URL param
  const [source, setSource] = useState('Website')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const src = params.get('source')
    if (src) setSource(src)
  }, [])

  // Fetch availability when reaching step 3
  useEffect(() => {
    if (step === 3) {
      fetchAvailability()
    }
  }, [step])

  async function fetchAvailability() {
    setLoadingSlots(true)
    try {
      // Get all available slots
      const { data: slots } = await supabase
        .from('calendar_availability')
        .select('*')
        .eq('is_available', true)
        .order('day_of_week')
        .order('time_slot')

      // Get already booked slots for the next 2 weeks
      const today = new Date()
      const twoWeeksOut = new Date(today)
      twoWeeksOut.setDate(today.getDate() + 14)

      const { data: booked } = await supabase
        .from('booked_slots')
        .select('*')
        .gte('slot_date', today.toISOString().split('T')[0])
        .lte('slot_date', twoWeeksOut.toISOString().split('T')[0])

      // Group available slots by day
      const grouped = {}
      if (slots) {
        slots.forEach(slot => {
          if (!grouped[slot.day_of_week]) {
            grouped[slot.day_of_week] = []
          }
          grouped[slot.day_of_week].push(slot.time_slot)
        })
      }

      setAvailability(grouped)
      setBookedSlots(booked || [])
    } catch (err) {
      console.error('Error fetching availability:', err)
    } finally {
      setLoadingSlots(false)
    }
  }

  // Get the next occurrence of a day_of_week from today
  function getNextDate(dayOfWeek) {
    const today = new Date()
    const todayDay = today.getDay() // 0=Sun, 1=Mon, ...
    // Convert our dayOfWeek (1=Mon..5=Fri) to JS day (1=Mon..5=Fri) — same mapping
    let daysUntil = dayOfWeek - todayDay
    if (daysUntil <= 0) daysUntil += 7
    const nextDate = new Date(today)
    nextDate.setDate(today.getDate() + daysUntil)
    return nextDate
  }

  function isSlotBooked(dayOfWeek, timeSlot) {
    const date = getNextDate(dayOfWeek)
    const dateStr = date.toISOString().split('T')[0]
    return bookedSlots.some(
      b => b.slot_date === dateStr && b.time_slot === timeSlot
    )
  }

  // Validation
  function isStep1Valid() {
    return (
      contact.full_name.trim() &&
      contact.company_name.trim() &&
      contact.email.trim() &&
      contact.phone.trim()
    )
  }

  function isStep2Valid() {
    return responses.q1 && responses.q2 && responses.q3 && responses.q4 && responses.q5
  }

  function isStep3Valid() {
    return selectedSlot !== null
  }

  // Navigation
  function goNext() {
    if (step < 3) setStep(step + 1)
  }

  function goBack() {
    if (step > 1) setStep(step - 1)
  }

  // Submit the form
  async function handleSubmit() {
    if (!isStep3Valid()) return
    setSubmitting(true)

    try {
      // Score the lead
      const scoreResult = scoreLead(responses)

      // Get response labels for storage
      const q1Option = QUALIFICATION_QUESTIONS.q1.options.find(o => o.value === responses.q1)
      const q2Option = QUALIFICATION_QUESTIONS.q2.options.find(o => o.value === responses.q2)
      const q3Option = QUALIFICATION_QUESTIONS.q3.options.find(o => o.value === responses.q3)
      const q4Option = QUALIFICATION_QUESTIONS.q4.options.find(o => o.value === responses.q4)
      const q5Option = QUALIFICATION_QUESTIONS.q5.options.find(o => o.value === responses.q5)

      // Calculate scheduled date
      const scheduledDate = getNextDate(selectedSlot.dayOfWeek)
      const scheduledDateStr = scheduledDate.toISOString().split('T')[0]
      const dayLabel = DAYS_OF_WEEK.find(d => d.value === selectedSlot.dayOfWeek)?.label

      // Determine initial stage
      const isQualified = scoreResult.classification !== 'cold'
      const initialStage = isQualified ? 'Scheduled' : 'Disqualified'

      // Insert the lead
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
          scheduled_time: selectedSlot.time,
          scheduled_date: scheduledDateStr,
          source,
        })
        .select()
        .single()

      if (leadError) throw leadError

      // Book the slot (only for qualified leads)
      if (isQualified) {
        await supabase.from('booked_slots').insert({
          lead_id: lead.id,
          slot_date: scheduledDateStr,
          time_slot: selectedSlot.time,
          day_of_week: selectedSlot.dayOfWeek,
        })

        // Insert initial stage history
        await supabase.from('lead_stage_history').insert({
          lead_id: lead.id,
          stage: 'Scheduled',
        })
      }

      setSubmitResult({
        qualified: isQualified,
        classification: scoreResult.classification,
        scheduledDay: dayLabel,
        scheduledTime: selectedSlot.time,
        scheduledDate: scheduledDate,
      })
      setSubmitted(true)
    } catch (err) {
      console.error('Submission error:', err)
      alert('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // Confirmation screen after submission
  if (submitted && submitResult) {
    return (
      <div className="intake-page">
        <div className="intake-container">
          <div className="intake-logo">
            {CAC_LOGO}
            <div className="intake-logo-text">
              <span className="intake-logo-cipher">CIPHER AI</span>
              <span className="intake-logo-consultants">CONSULTANTS</span>
            </div>
          </div>

          {submitResult.qualified ? (
            <div className="intake-confirmation">
              <div className="intake-confirm-icon">✓</div>
              <h1 className="intake-title">Discovery Call Confirmed</h1>
              <p className="intake-subtitle">
                Your call is scheduled for{' '}
                <strong>{submitResult.scheduledDay}</strong> at{' '}
                <strong>{submitResult.scheduledTime}</strong>.
              </p>
              <p className="intake-confirm-detail">
                You'll receive a confirmation email shortly
                with details on what to expect.
              </p>
            </div>
          ) : (
            <div className="intake-confirmation">
              <div className="intake-confirm-icon-muted">
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <circle cx="14" cy="14" r="11" />
                  <path d="M14 9v6M14 19v.5" />
                </svg>
              </div>
              <h1 className="intake-title">Thank You for Your Interest</h1>
              <p className="intake-subtitle">
                We appreciate you taking the time to tell us about your business.
              </p>
              <p className="intake-confirm-detail">
                Based on the information provided, our services may not be the
                right fit at this time. We'll send you an email with some
                resources, and you're welcome to reconnect when your needs evolve.
              </p>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="intake-page">
      <div className="intake-container">
        {/* Logo */}
        <div className="intake-logo">
          {CAC_LOGO}
          <div className="intake-logo-text">
            <span className="intake-logo-cipher">CIPHER AI</span>
            <span className="intake-logo-consultants">CONSULTANTS</span>
          </div>
        </div>

        <h1 className="intake-title">Book a Discovery Call</h1>
        <p className="intake-subtitle">
          Tell us about your business so we can prepare for our conversation.
        </p>

        {/* Step indicator */}
        <div className="intake-steps" data-step={step}>
          {STEPS.map((s, i) => (
            <div
              key={s.key}
              className={`intake-step-tab ${
                step === i + 1 ? 'active' : ''
              } ${step > i + 1 ? 'completed' : ''}`}
            >
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
              <input
                id="full_name"
                type="text"
                className="form-input"
                placeholder="Full Name"
                value={contact.full_name}
                onChange={e => setContact({ ...contact, full_name: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="company_name">Company Name</label>
              <input
                id="company_name"
                type="text"
                className="form-input"
                placeholder="Company Name"
                value={contact.company_name}
                onChange={e => setContact({ ...contact, company_name: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="email">Email Address</label>
              <input
                id="email"
                type="email"
                className="form-input"
                placeholder="Email Address"
                value={contact.email}
                onChange={e => setContact({ ...contact, email: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="phone">Phone Number</label>
              <input
                id="phone"
                type="tel"
                className="form-input"
                placeholder="Phone Number"
                value={contact.phone}
                onChange={e => setContact({ ...contact, phone: e.target.value })}
              />
            </div>

            <div className="intake-nav">
              <button
                className="btn btn-primary"
                onClick={goNext}
                disabled={!isStep1Valid()}
              >
                Continue →
              </button>
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
                    <div
                      key={option.value}
                      className={`radio-option ${
                        responses[key] === option.value ? 'selected' : ''
                      }`}
                      onClick={() =>
                        setResponses({ ...responses, [key]: option.value })
                      }
                    >
                      <input
                        type="radio"
                        name={key}
                        value={option.value}
                        checked={responses[key] === option.value}
                        readOnly
                      />
                      <label>{option.label}</label>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <div className="intake-nav">
              <button className="btn btn-secondary" onClick={goBack}>
                ← Back
              </button>
              <button
                className="btn btn-primary"
                onClick={goNext}
                disabled={!isStep2Valid()}
              >
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Schedule Call */}
        {step === 3 && (
          <div className="intake-step-content">
            <h2 className="intake-section-title">Schedule Your Discovery Call</h2>
            <p className="intake-schedule-subtitle">
              Select a date and time that works for you.
            </p>

            {loadingSlots ? (
              <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '2rem' }}>
                Loading available slots...
              </p>
            ) : (
              <div className="schedule-grid">
                {DAYS_OF_WEEK.map(day => {
                  const slots = availability[day.value] || []
                  if (slots.length === 0) return null

                  return (
                    <div key={day.value} className="schedule-day">
                      <div className="schedule-day-label">{day.label}</div>
                      <div className="schedule-slots">
                        {slots.map(time => {
                          const booked = isSlotBooked(day.value, time)
                          const isSelected =
                            selectedSlot?.dayOfWeek === day.value &&
                            selectedSlot?.time === time

                          return (
                            <button
                              key={time}
                              className={`schedule-slot ${
                                isSelected ? 'selected' : ''
                              } ${booked ? 'booked' : ''}`}
                              onClick={() =>
                                !booked &&
                                setSelectedSlot({
                                  dayOfWeek: day.value,
                                  time,
                                })
                              }
                              disabled={booked}
                            >
                              {time}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            <div className="intake-nav">
              <button className="btn btn-secondary" onClick={goBack}>
                ← Back
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSubmit}
                disabled={!isStep3Valid() || submitting}
              >
                {submitting ? 'Submitting...' : 'Book Discovery Call'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
