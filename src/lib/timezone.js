import { DateTime } from 'luxon'

export const DEFAULT_TIMEZONE = 'Africa/Nairobi'

// Common IANA zones for the picker — kept short and recognizable rather than
// the full ~400-zone IANA list, with an "All zones" escape hatch via <datalist>.
export const COMMON_TIMEZONES = [
  'Africa/Nairobi', 'Africa/Lagos', 'Africa/Cairo', 'Africa/Johannesburg',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow',
  'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Dhaka', 'Asia/Bangkok',
  'Asia/Singapore', 'Asia/Shanghai', 'Asia/Tokyo',
  'Australia/Sydney', 'Pacific/Auckland',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Sao_Paulo', 'UTC',
]

export function detectTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE
  } catch {
    return DEFAULT_TIMEZONE
  }
}

export function allTimezones() {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return COMMON_TIMEZONES
  }
}

// scheduled_date ('YYYY-MM-DD') + scheduled_time ('HH:mm') are stored as a
// wall-clock reading in `sourceZone` (the team's operating timezone). This
// resolves that to the actual instant, then reads it back in `targetZone`.
export function convertScheduledTime(scheduledDate, scheduledTime, sourceZone, targetZone) {
  if (!scheduledDate || !scheduledTime) return null
  const source = sourceZone || DEFAULT_TIMEZONE
  const target = targetZone || source
  const dt = DateTime.fromISO(`${scheduledDate}T${scheduledTime}`, { zone: source }).setZone(target)
  if (!dt.isValid) return null
  return {
    dateTime: dt,
    day: dt.toFormat('cccc, d LLLL yyyy'),
    dayShort: dt.toFormat('ccc, d LLL'),
    time: dt.toFormat('h:mm a'),
    zoneAbbr: dt.toFormat('ZZZZ'),
    sameDay: dt.toISODate() === scheduledDate,
  }
}

export function todayISODateInZone(zone) {
  return DateTime.now().setZone(zone || DEFAULT_TIMEZONE).toISODate()
}

export function formatOffsetLabel(zone) {
  try {
    const dt = DateTime.now().setZone(zone)
    if (!dt.isValid) return zone
    return `${zone} (${dt.toFormat('ZZZZ')})`
  } catch {
    return zone
  }
}
