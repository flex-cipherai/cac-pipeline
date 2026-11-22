// Wall-clock time in an IANA timezone ↔ UTC, without a date library.

function offsetMinutes(utc: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(utc)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return (asUtc - utc.getTime()) / 60000
}

// "2026-11-24" + "09:30" in Africa/Nairobi → the UTC instant.
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm))
  const first = new Date(guess.getTime() - offsetMinutes(guess, timeZone) * 60000)
  // Second pass settles DST edges.
  return new Date(guess.getTime() - offsetMinutes(first, timeZone) * 60000)
}

// Calendar date (YYYY-MM-DD) and ISO weekday (1 = Monday) of an instant in a timezone.
export function zonedDay(utc: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(utc)
  const get = (t: string) => parts.find((p) => p.type === t)?.value || ''
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday')) + 1
  return { date: `${get('year')}-${get('month')}-${get('day')}`, weekday }
}

// Slot instants strictly after `from` and up to `until`, for weekly slots
// [{ weekday: 1-7, time: 'HH:MM' }] in a timezone, sorted.
export function upcomingSlots(slots: { weekday: number; time: string }[], timeZone: string, from: Date, until: Date): Date[] {
  const out: Date[] = []
  const days = Math.ceil((until.getTime() - from.getTime()) / 86400000) + 1
  for (let i = 0; i <= days; i++) {
    const { date, weekday } = zonedDay(new Date(from.getTime() + i * 86400000), timeZone)
    for (const s of slots) {
      if (Number(s.weekday) !== weekday) continue
      const at = zonedToUtc(date, String(s.time).slice(0, 5), timeZone)
      if (at > from && at <= until && !out.some((o) => o.getTime() === at.getTime())) out.push(at)
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime())
}
