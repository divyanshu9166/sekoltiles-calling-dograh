/** Canonical showroom booking rules shared by the Dograh HTTP routes. */
export const APPOINTMENT_TIME_ZONE = 'Asia/Kolkata'

export const APPOINTMENT_SLOTS = [
  '10:00 AM',
  '11:00 AM',
  '12:00 PM',
  '2:00 PM',
  '3:00 PM',
  '4:00 PM',
  '5:00 PM',
] as const

const SLOT_BY_MINUTE = new Map<number, (typeof APPOINTMENT_SLOTS)[number]>([
  [10 * 60, '10:00 AM'], [11 * 60, '11:00 AM'], [12 * 60, '12:00 PM'],
  [14 * 60, '2:00 PM'], [15 * 60, '3:00 PM'], [16 * 60, '4:00 PM'], [17 * 60, '5:00 PM'],
])

export function indiaDateString(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APPOINTMENT_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value
  return `${pick('year')}-${pick('month')}-${pick('day')}`
}

export function normalizeAppointmentDate(value: unknown, today = indiaDateString()): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day ||
    value < today
  ) return null
  return value
}

export function addIndiaCalendarDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  const result = new Date(Date.UTC(year, month - 1, day + days))
  return result.toISOString().slice(0, 10)
}

export function isSundayAppointmentDate(date: string): boolean {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 0
}

export function nextOpenAppointmentDate(date: string): string {
  let candidate = addIndiaCalendarDays(date, 1)
  while (isSundayAppointmentDate(candidate)) candidate = addIndiaCalendarDays(candidate, 1)
  return candidate
}

/**
 * Uses the customer's original spoken phrase as the authority for relative
 * dates. This prevents an LLM from turning “कल 13 तारीख” into a past month.
 */
export function resolveAppointmentDate(
  generatedDate: unknown,
  spokenDate: unknown,
  today = indiaDateString(),
): string | null {
  if (typeof spokenDate === 'string') {
    const phrase = spokenDate.trim().toLocaleLowerCase('en-IN')
    if (phrase.includes('tomorrow') || phrase.includes('कल') || /(^|\s)kal($|\s)/i.test(phrase)) {
      return addIndiaCalendarDays(today, 1)
    }
    if (phrase.includes('today') || phrase.includes('आज') || /(^|\s)aaj($|\s)/i.test(phrase)) {
      return today
    }
  }
  return normalizeAppointmentDate(generatedDate, today)
}

/** Returns the fixed slot label; supports 24-hour input from HTML time fields. */
export function normalizeAppointmentTime(value: unknown): (typeof APPOINTMENT_SLOTS)[number] | null {
  if (typeof value !== 'string') return null
  const text = value.trim().toUpperCase().replace(/\s+/g, ' ')
  const twelveHour = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/)
  let minutes: number
  if (twelveHour) {
    const hour = Number(twelveHour[1])
    const minute = Number(twelveHour[2] ?? '0')
    if (hour < 1 || hour > 12 || minute > 59) return null
    minutes = (hour % 12) * 60 + minute + (twelveHour[3] === 'PM' ? 12 * 60 : 0)
  } else {
    const twentyFourHour = text.match(/^(\d{1,2}):(\d{2})$/)
    if (!twentyFourHour) return null
    const hour = Number(twentyFourHour[1])
    const minute = Number(twentyFourHour[2])
    if (hour > 23 || minute > 59) return null
    minutes = hour * 60 + minute
  }
  return SLOT_BY_MINUTE.get(minutes) ?? null
}

export function timeToMinutes(value: string): number | null {
  const slot = normalizeAppointmentTime(value)
  if (!slot) return null
  const match = slot.match(/^(\d+):\d+ (AM|PM)$/)
  if (!match) return null
  return (Number(match[1]) % 12) * 60 + (match[2] === 'PM' ? 12 * 60 : 0)
}

export function normalizeCustomerPhone(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const phone = value.replace(/[\s().-]/g, '')
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) return null
  return phone.startsWith('+91') && !/^\+91[6-9]\d{9}$/.test(phone) ? null : phone
}
