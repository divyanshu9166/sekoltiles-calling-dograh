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

/** Month-name → number for fuzzy date parsing. */
const MONTH_MAP: Record<string, number> = {
  // Hindi
  'जनवरी': 1, 'फरवरी': 2, 'फ़रवरी': 2, 'मार्च': 3, 'अप्रैल': 4,
  'मई': 5, 'जून': 6, 'जुलाई': 7, 'अगस्त': 8,
  'सितंबर': 9, 'सितम्बर': 9, 'अक्टूबर': 10, 'अक्तूबर': 10,
  'नवंबर': 11, 'नवम्बर': 11, 'दिसंबर': 12, 'दिसम्बर': 12,
  // English
  'january': 1, 'february': 2, 'march': 3, 'april': 4,
  'may': 5, 'june': 6, 'july': 7, 'august': 8,
  'september': 9, 'october': 10, 'november': 11, 'december': 12,
  'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'jun': 6,
  'jul': 7, 'aug': 8, 'sep': 9, 'sept': 9,
  'oct': 10, 'nov': 11, 'dec': 12,
}

/** Best-effort extraction of day+month from informal Hindi/English text. */
function parseFuzzyDate(value: string, today: string): string | null {
  const text = value.trim().toLocaleLowerCase('en-IN')
  const [todayYear, todayMonth, todayDay] = today.split('-').map(Number)

  const dayMatch = text.match(/\b(\d{1,2})\b/)
  if (!dayMatch) return null
  const day = Number(dayMatch[1])
  if (day < 1 || day > 31) return null

  let month: number | null = null
  for (const [name, num] of Object.entries(MONTH_MAP)) {
    if (text.includes(name)) { month = num; break }
  }

  // "16 tarikh" / "16 तारीख" / "16 को" → infer current or next month
  if (!month && /tarikh|तारीख|tarik|ko\b|को/.test(text)) {
    month = day >= todayDay ? todayMonth : (todayMonth === 12 ? 1 : todayMonth + 1)
  }

  if (!month || month < 1 || month > 12) return null
  let year = todayYear
  if (month < todayMonth || (month === todayMonth && day < todayDay)) year++
  const candidate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return normalizeAppointmentDate(candidate, today)
}

/**
 * Uses the customer's original spoken phrase as the authority for relative
 * dates. This prevents an LLM from turning "कल 13 तारीख" into a past month.
 * Falls back to fuzzy parsing for Hindi month names, "X tarikh", etc.
 */
export function resolveAppointmentDate(
  generatedDate: unknown,
  spokenDate: unknown,
  today = indiaDateString(),
): string | null {
  if (typeof spokenDate === 'string') {
    const phrase = spokenDate.trim().toLocaleLowerCase('en-IN')
    if (/yesterday|बीते|बीता|पिछले/.test(phrase)) return null
    if (/day after tomorrow|परसों|parso[n]?/.test(phrase)) return addIndiaCalendarDays(today, 2)
    if (/\btomorrow\b|(^|\s)कल(?=$|\s)|(^|\s)kal(?=$|\s)/i.test(phrase)) {
      return addIndiaCalendarDays(today, 1)
    }
    if (phrase.includes('today') || phrase.includes('आज') || /(^|\s)aaj($|\s)/i.test(phrase)) {
      return today
    }
  }
  // Strict YYYY-MM-DD check first
  const strict = normalizeAppointmentDate(generatedDate, today) || normalizeAppointmentDate(spokenDate, today)
  if (strict) return strict
  // Fuzzy date parsing (Hindi month names, "X tarikh", etc.)
  if (typeof generatedDate === 'string') { const f = parseFuzzyDate(generatedDate, today); if (f) return f }
  if (typeof spokenDate === 'string') { const f = parseFuzzyDate(spokenDate, today); if (f) return f }
  return null
}

/** Returns the fixed slot label; supports Hindi time, bare numbers, and 24-hour input. */
export function normalizeAppointmentTime(value: unknown): (typeof APPOINTMENT_SLOTS)[number] | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()

  // Hindi: "2 बजे", "दोपहर 3 बजे", "सुबह 10 बजे"
  const hindiMatch = raw.match(/(\d{1,2})\s*(?:बजे|baje)/i)
  if (hindiMatch) {
    const h = Number(hindiMatch[1])
    if (h >= 10 && h <= 12) return SLOT_BY_MINUTE.get(h * 60) ?? null
    if (h >= 2 && h <= 5) return SLOT_BY_MINUTE.get((h + 12) * 60) ?? null
    if (h >= 14 && h <= 17) return SLOT_BY_MINUTE.get(h * 60) ?? null
    return null
  }

  // Bare number: "2", "10", "3"
  if (/^\d{1,2}$/.test(raw)) {
    const h = Number(raw)
    if (h >= 10 && h <= 12) return SLOT_BY_MINUTE.get(h * 60) ?? null
    if (h >= 2 && h <= 5) return SLOT_BY_MINUTE.get((h + 12) * 60) ?? null
    if (h >= 14 && h <= 17) return SLOT_BY_MINUTE.get(h * 60) ?? null
    return null
  }

  const text = raw.toUpperCase().replace(/\s+/g, ' ')
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
  let phone = value.trim()
  // Strip SIP URI / trunk prefixes like PJSIP/+919166623128@vobiz or sip:9166623128@...
  phone = phone.replace(/^(?:PJSIP\/|SIP\/|sip:)/i, '')
  phone = phone.replace(/@.*$/, '')
  phone = phone.replace(/[\s().-]/g, '')
  // ARI preserves carrier caller ID, which commonly omits the leading +.
  if (/^91[6-9]\d{9}$/.test(phone)) phone = `+${phone}`
  else if (/^[6-9]\d{9}$/.test(phone)) phone = `+91${phone}`
  else if (/^0091[6-9]\d{9}$/.test(phone)) phone = `+${phone.slice(2)}`
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) return null
  return phone.startsWith('+91') && !/^\+91[6-9]\d{9}$/.test(phone) ? null : phone
}

export function resolveCustomerPhone(input: {
  direction?: unknown
  crmPhone?: unknown
  calledNumber?: unknown
  phone?: unknown
  providedPhone?: unknown
  fallbackPhone?: unknown
}): string | null {
  const dir = typeof input.direction === 'string' ? input.direction.trim().toLowerCase() : ''
  const crm = normalizeCustomerPhone(input.crmPhone)
  const called = normalizeCustomerPhone(input.calledNumber)
  const caller = normalizeCustomerPhone(input.phone)
  const provided = normalizeCustomerPhone(input.providedPhone) || normalizeCustomerPhone(input.fallbackPhone)

  // In outbound calls, the customer is the dialed number (crmPhone or calledNumber), never the agent's outbound caller ID (phone).
  if (dir === 'outbound') {
    return crm || called || provided || null
  }
  // In inbound calls, the customer is the incoming caller ID (phone).
  if (dir === 'inbound') {
    return caller || provided || null
  }
  // If direction is unspecified, prioritize crmPhone (the lead contact), then called, then provided, then caller.
  return crm || called || provided || caller || null
}

export function isPastAppointmentSlot(date: string, time: string, now = new Date()): boolean {
  const minutes = timeToMinutes(time)
  if (minutes === null) return true
  return new Date(`${date}T00:00:00+05:30`).getTime() + minutes * 60_000 <= now.getTime()
}

export function sanitizeCustomerName(value: unknown): string {
  if (typeof value !== 'string') return ''
  let name = value.trim()
  if (name.includes('{{')) return ''
  // Strip full phone numbers with optional + or 91 country code
  name = name.replace(/(?:\+?91)?[6-9]\d{9}/g, '')
  // Strip any sequences of 4 or more digits
  name = name.replace(/\d{4,}/g, '')
  // Strip any remaining digits
  name = name.replace(/\d+/g, '')
  // Strip punctuation and symbols like hyphens, underscores, dots, commas, parentheses
  name = name.replace(/^[\s\-_.#(),+]+|[\s\-_.#(),+]+$/g, '')
  // Collapse whitespace
  name = name.replace(/\s+/g, ' ').trim()
  if (!name || /^(?:customer|unknown|unknown customer|client|party|na|null|none|user)$/i.test(name)) {
    return ''
  }
  return name.slice(0, 80)
}
