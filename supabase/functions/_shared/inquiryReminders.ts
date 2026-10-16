// Decides which inquiry reminders to send and to whom. Pure functions, no Deno or network calls, so the
// rules can be tested on their own; send-inquiry-reminders/index.ts does the fetching, emailing and stamping.
//
// The attention rules mirror src/lib/inquiries.js (REPLY_TARGET_HOURS, QUIET_AFTER_DAYS). Keep them in sync.

export const REPLY_TARGET_HOURS = 24
export const QUIET_AFTER_DAYS = 7
// Reply alerts are only sent in working hours (team timezone, local hour from..to exclusive), so nobody
// is pinged at 3am. An alert held back is simply sent by the next hourly run that falls inside them.
export const WORK_START_HOUR = 8
export const WORK_END_HOUR = 18

const HOUR = 3_600_000
const DAY = 86_400_000

export const OPEN_STATUSES = ['new', 'contacted', 'engaged']

export interface Inquiry {
  id: string
  full_name: string
  company_name: string | null
  email: string | null
  phone: string | null
  channel: string
  status: string
  assigned_to: string | null
  next_follow_up: string | null          // YYYY-MM-DD
  received_at: string
  first_response_at: string | null
  last_contact_at: string | null
  reminder_before_sent_for: string | null // YYYY-MM-DD
  reminder_due_sent_for: string | null    // YYYY-MM-DD
  quiet_alert_sent_for: string | null     // the last-contact instant the alert was sent for
  reply_alert_sent_at: string | null
}

export interface Recipient {
  id: string
  name: string | null
  email: string | null
  role: string
}

export type ReminderKind = 'follow_up_due' | 'follow_up_tomorrow' | 'gone_quiet' | 'reply_overdue'

export interface Item {
  inquiry: Inquiry
  kind: ReminderKind
}

export interface Digest {
  recipient: Recipient
  items: Item[]
}

// ── Dates in the team's timezone ──

export function localDate(now: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function localHour(now: Date, timeZone: string): number {
  const h = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now)
  return Number(h)
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return t.toISOString().slice(0, 10)
}

// ── Which inquiries need which reminder ──

export function isOpen(i: Inquiry): boolean {
  return OPEN_STATUSES.includes(i.status)
}

function lastContactAt(i: Inquiry): string {
  return i.last_contact_at || i.received_at
}

function sameInstant(a: string | null, b: string | null): boolean {
  return !!a && !!b && new Date(a).getTime() === new Date(b).getTime()
}

export function followUpItems(inquiries: Inquiry[], today: string): Item[] {
  const tomorrow = addDays(today, 1)
  const items: Item[] = []
  for (const i of inquiries) {
    if (!isOpen(i) || !i.next_follow_up) continue
    if (i.next_follow_up <= today) {
      // Once per follow-up date. "<=" so a day the job missed is caught up rather than lost.
      if (i.reminder_due_sent_for !== i.next_follow_up) items.push({ inquiry: i, kind: 'follow_up_due' })
    } else if (i.next_follow_up === tomorrow && i.reminder_before_sent_for !== tomorrow) {
      items.push({ inquiry: i, kind: 'follow_up_tomorrow' })
    }
  }
  return items
}

export function quietItems(inquiries: Inquiry[], now: Date): Item[] {
  return inquiries
    .filter(i =>
      isOpen(i) && i.status !== 'new' && !i.next_follow_up &&
      now.getTime() - new Date(lastContactAt(i)).getTime() > QUIET_AFTER_DAYS * DAY &&
      // once per quiet spell: a new contact changes last_contact_at, which re-arms it
      !sameInstant(i.quiet_alert_sent_for, lastContactAt(i)))
    .map(i => ({ inquiry: i, kind: 'gone_quiet' as const }))
}

export function replyOverdueItems(inquiries: Inquiry[], now: Date): Item[] {
  return inquiries
    .filter(i =>
      i.status === 'new' && !i.first_response_at && !i.reply_alert_sent_at &&
      now.getTime() - new Date(i.received_at).getTime() > REPLY_TARGET_HOURS * HOUR)
    .map(i => ({ inquiry: i, kind: 'reply_overdue' as const }))
}

// ── Who gets told ──

// The owner if they are still someone who can use inquiries, otherwise everyone who can.
export function assignRecipients(items: Item[], recipients: Recipient[]): Digest[] {
  const byId = new Map(recipients.map(r => [r.id, r]))
  const buckets = new Map<string, Item[]>()
  for (const item of items) {
    const owner = item.inquiry.assigned_to ? byId.get(item.inquiry.assigned_to) : undefined
    const targets = owner ? [owner] : recipients
    for (const r of targets) {
      if (!buckets.has(r.id)) buckets.set(r.id, [])
      buckets.get(r.id)!.push(item)
    }
  }
  return [...buckets.entries()].map(([id, list]) => ({ recipient: byId.get(id)!, items: list }))
}

export function planDaily(inquiries: Inquiry[], recipients: Recipient[], now: Date, timeZone: string): Digest[] {
  const today = localDate(now, timeZone)
  return assignRecipients([...followUpItems(inquiries, today), ...quietItems(inquiries, now)], recipients)
}

export function planReplyAlerts(inquiries: Inquiry[], recipients: Recipient[], now: Date, timeZone: string): Digest[] {
  const hour = localHour(now, timeZone)
  if (hour < WORK_START_HOUR || hour >= WORK_END_HOUR) return []
  return assignRecipients(replyOverdueItems(inquiries, now), recipients)
}

// The column to stamp once an item has been delivered, so it is not sent again.
export function stampFor(item: Item, now: Date, timeZone: string): Record<string, string | null> {
  const today = localDate(now, timeZone)
  switch (item.kind) {
    case 'follow_up_due': return { reminder_due_sent_for: item.inquiry.next_follow_up }
    case 'follow_up_tomorrow': return { reminder_before_sent_for: addDays(today, 1) }
    case 'gone_quiet': return { quiet_alert_sent_for: lastContactAt(item.inquiry) }
    case 'reply_overdue': return { reply_alert_sent_at: now.toISOString() }
  }
}

// ── Wording ──

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp', phone: 'Phone call', email: 'Email', linkedin: 'LinkedIn',
  referral: 'Referral', event: 'Event', website: 'Website', other: 'Other',
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function formatDay(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
}

// Why this item is on the list, in a few words.
export function reasonText(item: Item, now: Date, timeZone: string): string {
  const i = item.inquiry
  switch (item.kind) {
    case 'follow_up_due': {
      const today = localDate(now, timeZone)
      return i.next_follow_up === today ? 'follow-up due today' : `follow-up was due ${formatDay(i.next_follow_up!)}`
    }
    case 'follow_up_tomorrow': return 'follow-up due tomorrow'
    case 'gone_quiet': {
      const days = Math.floor((now.getTime() - new Date(lastContactAt(i)).getTime()) / DAY)
      return `no contact for ${days} days`
    }
    case 'reply_overdue': {
      const hours = Math.floor((now.getTime() - new Date(i.received_at).getTime()) / HOUR)
      return hours >= 48 ? `waiting ${Math.floor(hours / 24)} days for a reply` : `waiting ${hours} hours for a reply`
    }
  }
}

function itemLine(item: Item, now: Date, timeZone: string): string {
  const i = item.inquiry
  const who = `<strong>${escapeHtml(i.full_name)}</strong>${i.company_name ? `, ${escapeHtml(i.company_name)}` : ''}`
  const how = `via ${CHANNEL_LABELS[i.channel] || 'Other'}`
  const contact = [i.phone, i.email].filter(Boolean).map(c => escapeHtml(c as string)).join(' · ')
  return `<li style="margin:0 0 10px;line-height:1.5;">${who}<br>` +
    `<span style="color:#666;font-size:13px;">${how} · ${escapeHtml(reasonText(item, now, timeZone))}${contact ? ` · ${contact}` : ''}</span></li>`
}

const SECTION_TITLES: Record<ReminderKind, string> = {
  follow_up_due: 'Follow up now',
  follow_up_tomorrow: 'Follow-up tomorrow',
  gone_quiet: 'Gone quiet',
  reply_overdue: 'Waiting for a first reply',
}
const SECTION_ORDER: ReminderKind[] = ['reply_overdue', 'follow_up_due', 'follow_up_tomorrow', 'gone_quiet']

// The HTML list that fills {{items_html}} in the email templates, one headed section per kind.
export function itemsHtml(items: Item[], now: Date, timeZone: string): string {
  return SECTION_ORDER
    .map(kind => {
      const group = items.filter(x => x.kind === kind)
      if (group.length === 0) return ''
      return `<h3 style="font-size:14px;margin:20px 0 8px;color:#201E1D;">${SECTION_TITLES[kind]} (${group.length})</h3>` +
        `<ul style="margin:0;padding-left:18px;font-size:14px;">${group.map(x => itemLine(x, now, timeZone)).join('')}</ul>`
    })
    .join('')
}

export function countByKind(items: Item[]): Record<ReminderKind, number> {
  const counts: Record<ReminderKind, number> = { follow_up_due: 0, follow_up_tomorrow: 0, gone_quiet: 0, reply_overdue: 0 }
  for (const x of items) counts[x.kind]++
  return counts
}

// Plain-text version for the in-app notification bell.
export function summaryText(items: Item[]): string {
  const c = countByKind(items)
  const parts: string[] = []
  if (c.reply_overdue) parts.push(`${c.reply_overdue} waiting for a first reply`)
  if (c.follow_up_due) parts.push(`${c.follow_up_due} to follow up now`)
  if (c.follow_up_tomorrow) parts.push(`${c.follow_up_tomorrow} due tomorrow`)
  if (c.gone_quiet) parts.push(`${c.gone_quiet} gone quiet`)
  return parts.join(', ')
}
