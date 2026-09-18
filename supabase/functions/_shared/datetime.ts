// Shared timezone helpers for edge functions. Mirrors src/lib/timezone.js —
// scheduled_date/scheduled_time are a wall-clock reading in the team's
// operating timezone (system_settings.team_timezone); this converts that
// reading into whatever timezone a given recipient (lead or staff member)
// should see it in.

import { DateTime } from 'https://esm.sh/luxon@3.5.0'

export const DEFAULT_TIMEZONE = 'Africa/Nairobi'

export function convertScheduledTime(scheduledDate: string, scheduledTime: string, sourceZone: string, targetZone: string) {
  if (!scheduledDate || !scheduledTime) return null
  const source = sourceZone || DEFAULT_TIMEZONE
  const target = targetZone || source
  const dt = DateTime.fromISO(`${scheduledDate}T${scheduledTime}`, { zone: source }).setZone(target)
  if (!dt.isValid) return null
  return {
    day: dt.toFormat('cccc, d LLLL yyyy'),
    time: dt.toFormat('h:mm a'),
    zoneAbbr: dt.toFormat('ZZZZ'),
    epochMs: dt.toMillis(),
  }
}

// Builds the template-variable set for a lead, with scheduled_day/time
// rendered in `targetZone` instead of the raw team-local values.
export function leadVars(lead: Record<string, unknown>, teamTimezone: string, targetZone: string) {
  const vars: Record<string, unknown> = { ...lead }
  if (lead.scheduled_date && lead.scheduled_time) {
    const converted = convertScheduledTime(lead.scheduled_date as string, lead.scheduled_time as string, teamTimezone, targetZone)
    if (converted) {
      vars.scheduled_day = converted.day
      vars.scheduled_time = converted.time
      vars.timezone = converted.zoneAbbr
    }
  }
  return vars
}
