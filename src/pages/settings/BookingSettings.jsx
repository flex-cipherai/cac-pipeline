import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { DAYS_OF_WEEK } from '../../lib/scoring'
import { COMMON_TIMEZONES, formatOffsetLabel } from '../../lib/timezone'
import { SettingsHeading } from './SettingsLayout'
import useToast from './useToast'

const ALL_TIME_SLOTS = [
  '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00',
]

// These are the only system_settings keys this page writes; the database lets anyone with the
// "Booking & availability" permission change exactly these (migration-permissions-enforcement.sql).
const DEFAULT_CONFIG = {
  booking_window_days: '14',
  booking_min_notice_hours: '4',
  booking_duration_minutes: '30',
  booking_buffer_minutes: '0',
  reminder_hours_before_call: '24',
  team_timezone: 'Africa/Nairobi',
  meeting_link: '',
  whatsapp_number: '254757230579',
}

export default function BookingSettings() {
  const { showToast, toast } = useToast()
  const [allSlots, setAllSlots] = useState([])
  const [bookingConfig, setBookingConfig] = useState(DEFAULT_CONFIG)
  const [savingConfig, setSavingConfig] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    const [availRes, configRes] = await Promise.all([
      supabase.from('calendar_availability').select('*').order('day_of_week').order('time_slot'),
      supabase.from('system_settings').select('key, value').in('key', Object.keys(DEFAULT_CONFIG)),
    ])
    if (availRes.data) setAllSlots(availRes.data)
    if (configRes.data) {
      const cfg = { ...DEFAULT_CONFIG }
      configRes.data.forEach(row => { if (row.key && row.value) cfg[row.key] = row.value })
      setBookingConfig(cfg)
    }
    setLoading(false)
  }

  function isSlotActive(day, time) {
    return allSlots.some(s => s.day_of_week === day && s.time_slot === time && s.is_available)
  }

  async function toggleSlot(day, time) {
    const existingRow = allSlots.find(s => s.day_of_week === day && s.time_slot === time)
    const active = isSlotActive(day, time)
    if (existingRow) {
      const { error } = await supabase.from('calendar_availability').update({ is_available: !active }).eq('id', existingRow.id)
      if (error) return showToast('error', 'Could not change that time slot')
      setAllSlots(prev => prev.map(s => s.id === existingRow.id ? { ...s, is_available: !active } : s))
    } else {
      const { data, error } = await supabase.from('calendar_availability')
        .insert({ day_of_week: day, time_slot: time, is_available: true }).select().single()
      if (error) return showToast('error', 'Could not add that time slot')
      if (data) setAllSlots(prev => [...prev, data])
    }
  }

  async function saveBookingConfig() {
    setSavingConfig(true)
    // One request, and the result is checked: the database now refuses a save the person has no right to make.
    const rows = Object.entries(bookingConfig).map(([key, value]) => ({ key, value: String(value) }))
    const { error } = await supabase.from('system_settings').upsert(rows, { onConflict: 'key' })
    setSavingConfig(false)
    if (error) return showToast('error', 'Failed to save booking settings')
    showToast('success', 'Booking settings saved')
  }

  if (loading) {
    return (
      <div>
        <SettingsHeading title="Booking & availability" />
        <div className="skeleton skeleton-card" style={{ height: 200 }} />
      </div>
    )
  }

  return (
    <div>
      <SettingsHeading title="Booking & availability" hint="When discovery calls can be booked, and the rules the booking page follows." />

      {/* ── Calendar Availability ── */}
      <div className="settings-section">
        <div className="settings-section-header">
          <h3 className="settings-section-title">Calendar Availability</h3>
          <p className="settings-section-hint">Click a time slot to toggle it on or off</p>
        </div>
        <div className="section-card">
          <div className="settings-calendar-grid">
            {DAYS_OF_WEEK.map(day => (
              <div key={day.value} className="settings-cal-column">
                <div className="settings-cal-day-header">{day.label}</div>
                <div className="settings-cal-slots">
                  {ALL_TIME_SLOTS.map(time => (
                    <button key={time} className={`settings-cal-toggle ${isSlotActive(day.value, time) ? 'active' : ''}`} onClick={() => toggleSlot(day.value, time)} title={isSlotActive(day.value, time) ? `Remove ${time}` : `Add ${time}`}>
                      {time}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Booking Configuration ── */}
      <div className="settings-section">
        <div className="settings-section-header">
          <h3 className="settings-section-title">Booking Configuration</h3>
        </div>
        <div className="section-card" style={{ padding: 'var(--space-lg)' }}>
          <div className="booking-config-grid">
            <div className="form-group">
              <label className="form-label">Meeting duration</label>
              <select className="form-input" value={bookingConfig.booking_duration_minutes} onChange={e => setBookingConfig({ ...bookingConfig, booking_duration_minutes: e.target.value })}>
                <option value="30">30 minutes</option>
                <option value="45">45 minutes</option>
                <option value="60">60 minutes</option>
                <option value="90">90 minutes</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Booking window</label>
              <select className="form-input" value={bookingConfig.booking_window_days} onChange={e => setBookingConfig({ ...bookingConfig, booking_window_days: e.target.value })}>
                <option value="7">7 days ahead</option>
                <option value="14">14 days ahead</option>
                <option value="21">21 days ahead</option>
                <option value="30">30 days ahead</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Minimum notice</label>
              <select className="form-input" value={bookingConfig.booking_min_notice_hours} onChange={e => setBookingConfig({ ...bookingConfig, booking_min_notice_hours: e.target.value })}>
                <option value="2">2 hours</option>
                <option value="4">4 hours</option>
                <option value="8">8 hours</option>
                <option value="24">24 hours (1 day)</option>
                <option value="48">48 hours (2 days)</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Buffer between calls</label>
              <select className="form-input" value={bookingConfig.booking_buffer_minutes} onChange={e => setBookingConfig({ ...bookingConfig, booking_buffer_minutes: e.target.value })}>
                <option value="0">No buffer</option>
                <option value="15">15 minutes</option>
                <option value="30">30 minutes</option>
                <option value="60">60 minutes</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Reminder timing</label>
              <select className="form-input" value={bookingConfig.reminder_hours_before_call} onChange={e => setBookingConfig({ ...bookingConfig, reminder_hours_before_call: e.target.value })}>
                <option value="1">1 hour before</option>
                <option value="2">2 hours before</option>
                <option value="4">4 hours before</option>
                <option value="24">24 hours before</option>
                <option value="48">48 hours before</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Team timezone</label>
              <select className="form-input" value={bookingConfig.team_timezone} onChange={e => setBookingConfig({ ...bookingConfig, team_timezone: e.target.value })}>
                {!COMMON_TIMEZONES.includes(bookingConfig.team_timezone) && bookingConfig.team_timezone && (
                  <option value={bookingConfig.team_timezone}>{formatOffsetLabel(bookingConfig.team_timezone)}</option>
                )}
                {COMMON_TIMEZONES.map(tz => (
                  <option key={tz} value={tz}>{formatOffsetLabel(tz)}</option>
                ))}
              </select>
              <span className="form-hint">The timezone Calendar Availability slots above are defined in.</span>
            </div>
            <div className="form-group">
              <label className="form-label">Meeting link (Google Meet)</label>
              <input className="form-input" type="url" placeholder="https://meet.google.com/abc-defg-hij" value={bookingConfig.meeting_link} onChange={e => setBookingConfig({ ...bookingConfig, meeting_link: e.target.value.trim() })} />
              <span className="form-hint">Shown on the booking confirmation page and in the confirmation email and calendar invite. Leave empty to say the link will be emailed.</span>
            </div>
            <div className="form-group">
              <label className="form-label">WhatsApp number</label>
              <input className="form-input" type="tel" placeholder="254757230579" value={bookingConfig.whatsapp_number} onChange={e => setBookingConfig({ ...bookingConfig, whatsapp_number: e.target.value.replace(/\D/g, '') })} />
              <span className="form-hint">Digits only, country code first. Used for the WhatsApp links in booking emails and on the booking page.</span>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-md)' }}>
            <button className="btn btn-primary btn-sm" onClick={saveBookingConfig} disabled={savingConfig}>
              {savingConfig ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>
        </div>
      </div>

      {toast}
    </div>
  )
}
