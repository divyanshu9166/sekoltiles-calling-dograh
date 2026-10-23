/**
 * lib/whatsapp/appointment-bot.ts
 *
 * WhatsApp Appointment Booking Chatbot — Redis-backed state machine.
 *
 * Flow:
 *   IDLE
 *     → (customer clicks "Schedule Appointment" button)
 *   COLLECTING_DATE
 *     → (customer sends a date like "kal", "tomorrow", "10 june", "2026-06-10")
 *   COLLECTING_TIME
 *     → (customer picks a time from offered slots)
 *   CONFIRMING
 *     → (customer says "yes" / "haan" to confirm)
 *   DONE  (terminal — state is cleared)
 *
 * State is stored in Redis with a 30-minute TTL. If the customer goes
 * silent for 30 minutes the session expires gracefully.
 *
 * Bookings use the calling agent's showroom rules from
 * lib/appointments/booking.ts (India time, 9 AM–5 PM, closed on Sundays,
 * several customers may share a slot) and land in the same Appointment
 * table as the Call Center's Appointments tab.
 *
 * Called from: app/api/whatsapp/webhook/route.ts → processMessage()
 */

import { redis } from '@/lib/redis'
import { prisma } from '@/lib/db'
import {
  sendTextMessage,
  sendInteractiveButtonMessage,
} from '@/lib/whatsapp/meta-api'
import {
  APPOINTMENT_SLOTS,
  addIndiaCalendarDays,
  indiaDateString,
  isPastAppointmentSlot,
  isSundayAppointmentDate,
  nextOpenAppointmentDate,
  normalizeAppointmentTime,
  normalizeCustomerPhone,
  resolveAppointmentDate,
  sanitizeCustomerName,
} from '@/lib/appointments/booking'

// ── Constants ────────────────────────────────────────────────────────────────

const STATE_TTL_SECONDS = 30 * 60 // 30 minutes

/** Fixed showroom time slots offered to the customer */
const AVAILABLE_SLOTS: string[] = [...APPOINTMENT_SLOTS]

// ── Types ────────────────────────────────────────────────────────────────────

type BotStep =
  | 'COLLECTING_DATE'
  | 'COLLECTING_TIME'
  | 'CONFIRMING'

interface BotState {
  step: BotStep
  /** ISO date string e.g. "2026-06-10" */
  date?: string
  /** Human-readable time e.g. "11:00 AM" */
  time?: string
  /** Contact's display name */
  contactName: string
  /** Contact's phone number (E.164) */
  contactPhone: string
  /** WA contact id */
  contactId: string
  /** WA conversation id — for saving the bot's reply message to DB */
  conversationId: string
  /** userId (CRM owner) — for WA config lookup */
  userId: string
}

interface WaConfig {
  phoneNumberId: string
  accessToken: string
}

/** Detect an explicit text request to start the showroom-booking workflow. */
export function isAppointmentBookingRequest(text: string): boolean {
  return /\b(appointment|book(?:\s+(?:an?\s+)?)?(?:appointment|visit)|schedule(?:\s+(?:an?\s+)?)?(?:appointment|visit)|showroom\s+visit)\b/i.test(text)
}

// ── Redis helpers ─────────────────────────────────────────────────────────────

function stateKey(conversationId: string): string {
  return `wa:appt-bot:${conversationId}`
}

export async function getBotState(conversationId: string): Promise<BotState | null> {
  try {
    const raw = await redis.get(stateKey(conversationId))
    if (!raw) return null
    return JSON.parse(raw) as BotState
  } catch {
    return null
  }
}

async function setBotState(state: BotState): Promise<void> {
  try {
    await redis.set(stateKey(state.conversationId), JSON.stringify(state), 'EX', STATE_TTL_SECONDS)
  } catch {
    // non-critical
  }
}

export async function clearBotState(conversationId: string): Promise<void> {
  try {
    await redis.del(stateKey(conversationId))
  } catch {
    // non-critical
  }
}

// ── Date parsing ──────────────────────────────────────────────────────────────

/**
 * Parse natural language date input (Hindi + English) into a YYYY-MM-DD string.
 * Returns null if the input is unrecognizable.
 */
function parseDate(input: string): string | null {
  const text = input.trim().toLowerCase()
  // India calendar days, like the calling agent, whatever the server timezone.
  const today = indiaDateString()
  const year = Number(today.slice(0, 4))

  // Relative dates ("day after tomorrow" first: it also contains "tomorrow")
  if (/\b(aaj|today|abhi)\b/i.test(text)) {
    return today
  }
  if (/\b(parso|day after tomorrow|2 din baad)\b/i.test(text)) {
    return addIndiaCalendarDays(today, 2)
  }
  if (/\b(kal|tomorrow|kal ko|kl)\b/i.test(text)) {
    return addIndiaCalendarDays(today, 1)
  }

  // ISO format: 2026-06-10
  const iso = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) {
    const d = toDateStr(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]))
    if (d) return d
  }

  // "10 june" or "june 10" or "10/06" or "10-06"
  const months: Record<string, number> = {
    january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2,
    april: 3, apr: 3, may: 4, june: 5, jun: 5, july: 6, jul: 6,
    august: 7, aug: 7, september: 8, sep: 8, october: 9, oct: 9,
    november: 10, nov: 10, december: 11, dec: 11,
  }
  const dayMonthMatch = text.match(/(\d{1,2})\s+(\w+)/)
  if (dayMonthMatch) {
    const day = parseInt(dayMonthMatch[1])
    const month = months[dayMonthMatch[2].toLowerCase()]
    if (month !== undefined && day >= 1 && day <= 31) {
      const d = toDateStr(year, month, day)
      if (d) return d
    }
  }
  const monthDayMatch = text.match(/(\w+)\s+(\d{1,2})/)
  if (monthDayMatch) {
    const month = months[monthDayMatch[1].toLowerCase()]
    const day = parseInt(monthDayMatch[2])
    if (month !== undefined && day >= 1 && day <= 31) {
      const d = toDateStr(year, month, day)
      if (d) return d
    }
  }
  // "10/06" or "10-06"
  const slashMatch = text.match(/^(\d{1,2})[\/\-](\d{1,2})$/)
  if (slashMatch) {
    const day = parseInt(slashMatch[1])
    const month = parseInt(slashMatch[2]) - 1
    const d = toDateStr(year, month, day)
    if (d) return d
  }

  // Hindi month names and "X tarikh", via the calling agent's date parser.
  return resolveAppointmentDate(input, input, today)
}

/** Build YYYY-MM-DD for a real calendar day (month is 0-based); null if invalid. */
function toDateStr(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month, day))
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month || d.getUTCDate() !== day) return null
  return d.toISOString().split('T')[0]
}

/** Format YYYY-MM-DD → "Sunday, 10 June 2026" */
function formatDateHuman(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  return d.toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  })
}

// ── Time parsing ──────────────────────────────────────────────────────────────

/** Convert "HH:MM AM/PM" → minutes since midnight */
function timeToMinutes(t: string): number {
  const normalized = t.trim().toUpperCase()
  const match = normalized.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/)
  if (!match) return -1
  let hours = parseInt(match[1], 10)
  const minutes = parseInt(match[2], 10)
  const period = match[3]
  if (period === 'PM' && hours !== 12) hours += 12
  if (period === 'AM' && hours === 12) hours = 0
  return hours * 60 + minutes
}

/**
 * Match user input to one of the fixed slot strings.
 * Handles: "11", "11am", "11:00", "11 baje", "2 PM", "do baje", etc.
 */
function parseTimeToSlot(input: string): string | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, ' ')

  // Direct slot match (case-insensitive)
  const directMatch = AVAILABLE_SLOTS.find(
    (slot) => slot.toLowerCase() === text || slot.toLowerCase().replace(':00', '') === text,
  )
  if (directMatch) return directMatch

  // Numeric hour extraction: "11", "11am", "11 baje", "2pm".
  // Prefer an hour explicitly followed by a time marker so a date such as
  // "25 Sep ko 3 bje" is not incorrectly read as 25 o'clock.
  const markedMatches = [...text.matchAll(/(\d{1,2})\s*(?:am|pm|baje|bje|o'?clock)\b/g)]
  const hourMatch = markedMatches.at(-1) ?? text.match(/(\d{1,2})\s*(?:am|pm|baje|bje|o'?clock)?/)
  if (hourMatch) {
    const hour = parseInt(hourMatch[1])
    const isPM = text.includes('pm') || (hour !== 12 && hour < 8)  // 2→2PM, 11→11AM heuristic
    const adjusted = isPM && hour !== 12 ? hour + 12 : hour
    // Find closest slot
    const targetMins = adjusted * 60
    const closest = AVAILABLE_SLOTS.find((slot) => {
      const slotMins = timeToMinutes(slot)
      return Math.abs(slotMins - targetMins) < 30
    })
    if (closest) return closest
  }

  // Hindi forms such as "दोपहर 3 बजे", via the calling agent's time parser.
  const spoken = normalizeAppointmentTime(input)
  if (spoken && AVAILABLE_SLOTS.includes(spoken)) return spoken

  return null
}

/**
 * True when the text names a time explicitly ("3 bje", "11 am", "2:00").
 * A date such as "15 june" alone must not be read as 3 PM.
 */
function hasExplicitTime(input: string): boolean {
  return /\d{1,2}\s*(?:am|pm|baje|bje|o'?clock|बजे)|\d{1,2}:\d{2}/i.test(input)
}

// ── Slot availability check ───────────────────────────────────────────────────

async function isSlotAvailable(
  dateStr: string,
  timeStr: string,
): Promise<{ available: boolean; suggestions: string[] }> {
  // Same rules as /api/appointments/check-slot: several customers may visit
  // at the same time, so only closed days and times already past are refused.
  if (isSundayAppointmentDate(dateStr)) return { available: false, suggestions: [] }
  if (!isPastAppointmentSlot(dateStr, timeStr)) return { available: true, suggestions: [] }

  const suggestions = futureSlots(dateStr).slice(0, 4)
  return { available: false, suggestions }
}

/** Showroom slots on `dateStr` that have not already passed in India. */
function futureSlots(dateStr: string): string[] {
  return AVAILABLE_SLOTS.filter((slot) => !isPastAppointmentSlot(dateStr, slot))
}

// ── Messaging helpers ─────────────────────────────────────────────────────────

async function sendBotReply(
  text: string,
  state: BotState,
  waConfig: WaConfig,
): Promise<void> {
  try {
    const result = await sendTextMessage({
      phoneNumberId: waConfig.phoneNumberId,
      accessToken: waConfig.accessToken,
      to: state.contactPhone,
      text,
    })

    // Persist reply to DB
    await prisma.waMessage.create({
      data: {
        conversation_id: state.conversationId,
        sender_type: 'agent',
        content_type: 'text',
        content_text: text,
        message_id: result.messageId,
        status: 'sent',
      },
    })
    await prisma.waConversation.update({
      where: { id: state.conversationId },
      data: { last_message_text: text, last_message_at: new Date() },
    })
  } catch (err) {
    console.error('[appt-bot] sendBotReply failed:', err)
  }
}

async function sendSlotsAsButtons(
  state: BotState,
  waConfig: WaConfig,
  slots: string[],
  introText: string,
): Promise<void> {
  const displaySlots = slots.slice(0, 3)  // WhatsApp max 3 buttons

  if (displaySlots.length === 0) {
    await sendBotReply(
      'Maafi, is din koi slot available nahi hai. Kripya koi aur din choose karein.\n\nPlease share another date (e.g. kal, 15 june):',
      state,
      waConfig,
    )
    await setBotState({ ...state, step: 'COLLECTING_DATE' })
    return
  }

  try {
    const result = await sendInteractiveButtonMessage({
      phoneNumberId: waConfig.phoneNumberId,
      accessToken: waConfig.accessToken,
      to: state.contactPhone,
      headerText: '📅 Sekol Tiles — Appointment',
      bodyText: introText,
      footerText: 'Showroom: 9 AM – 5 PM, Mon–Sat',
      buttons: displaySlots.map((slot) => ({ id: `SLOT_${slot}`, title: slot })),
    })

    await prisma.waMessage.create({
      data: {
        conversation_id: state.conversationId,
        sender_type: 'agent',
        content_type: 'text',
        content_text: introText,
        message_id: result.messageId,
        status: 'sent',
      },
    })
    await prisma.waConversation.update({
      where: { id: state.conversationId },
      data: { last_message_text: introText, last_message_at: new Date() },
    })
  } catch {
    // Fallback to plain text if interactive fails (e.g. outside 24h window)
    const slotList = displaySlots.join(' | ')
    await sendBotReply(`${introText}\n\nAvailable slots: ${slotList}`, state, waConfig)
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export interface AppointmentBotContext {
  conversationId: string
  contactId: string
  contactPhone: string
  contactName: string
  userId: string
  incomingText: string
  /** Set when the customer clicked a quick-reply button */
  buttonReplyId?: string
}

/**
 * Start a fresh appointment booking session.
 * Called when customer clicks the "Schedule Appointment" button.
 */
export async function startAppointmentBot(
  ctx: Omit<AppointmentBotContext, 'incomingText' | 'buttonReplyId'>,
  waConfig: WaConfig,
): Promise<void> {
  const state: BotState = {
    step: 'COLLECTING_DATE',
    contactName: ctx.contactName,
    contactPhone: ctx.contactPhone,
    contactId: ctx.contactId,
    conversationId: ctx.conversationId,
    userId: ctx.userId,
  }
  await setBotState(state)

  const greeting = `Sekol Tiles showroom visit schedule karne ke liye kaun si *tarikh* aapko suit karegi?\n\nPlease date share karein (e.g. kal, 15 june, 2026-06-15):`
  await sendBotReply(greeting, state, waConfig)
}

/**
 * Handle an incoming message when an appointment bot session is active.
 * Returns true if the message was handled by the bot (skip AI agent).
 */
export async function handleAppointmentBotMessage(
  ctx: AppointmentBotContext,
  waConfig: WaConfig,
): Promise<boolean> {
  const state = await getBotState(ctx.conversationId)
  if (!state) return false

  const text = ctx.incomingText.trim()
  const buttonId = ctx.buttonReplyId

  // ── Handle cancellation at any step ─────────────────────────────────────
  if (/\b(cancel|band karo|nahi|no|nahin|reh do)\b/i.test(text)) {
    await clearBotState(ctx.conversationId)
    await sendBotReply(
      'Theek hai! Appointment cancel kar diya. Jab bhi chahein, hum se baat karein. 😊',
      state,
      waConfig,
    )
    return true
  }

  // ── Step: COLLECTING_DATE ────────────────────────────────────────────────
  if (state.step === 'COLLECTING_DATE') {
    const parsedDate = parseDate(text)
    if (!parsedDate) {
      await sendBotReply(
        'Kripya valid date share karein jaise:\n• *kal* (tomorrow)\n• *15 june*\n• *2026-06-15*',
        state,
        waConfig,
      )
      return true
    }

    // Reject past dates
    if (parsedDate < indiaDateString()) {
      await sendBotReply(
        'Yeh date pehle ki hai. Kripya aaj ya aane wali koi tarikh choose karein:',
        state,
        waConfig,
      )
      return true
    }

    // The showroom is closed on Sundays (same rule as the calling agent).
    if (isSundayAppointmentDate(parsedDate)) {
      const nextOpen = formatDateHuman(nextOpenAppointmentDate(parsedDate))
      await sendBotReply(
        `Sunday ko showroom band rehta hai. Kripya Monday–Saturday ki koi tarikh choose karein (jaise *${nextOpen}*):`,
        state,
        waConfig,
      )
      return true
    }

    const updatedState: BotState = { ...state, step: 'COLLECTING_TIME', date: parsedDate }
    await setBotState(updatedState)

    // Customers often send date and time together, e.g. "25 Sep ko 3 bje".
    // Preserve that input instead of unnecessarily asking them for the time again.
    const inlineSlot = hasExplicitTime(text) ? parseTimeToSlot(text) : null
    if (inlineSlot) {
      const { available, suggestions } = await isSlotAvailable(parsedDate, inlineSlot)
      if (!available) {
        const humanDate = formatDateHuman(parsedDate)
        if (suggestions.length > 0) {
          await sendSlotsAsButtons(
            updatedState,
            waConfig,
            suggestions,
            `*${inlineSlot}* available nahi hai ${humanDate} ko. Inme se koi time choose karein:`,
          )
        } else {
          await setBotState({ ...updatedState, step: 'COLLECTING_DATE' })
          await sendBotReply(
            `Maafi, ${humanDate} ko koi slot available nahi hai. Kripya koi aur date share karein:`,
            updatedState,
            waConfig,
          )
        }
        return true
      }

      const confirmingState: BotState = { ...updatedState, step: 'CONFIRMING', time: inlineSlot }
      await setBotState(confirmingState)
      const humanDate = formatDateHuman(parsedDate)
      await sendBotReply(
        `✅ Slot available hai!\n\n📅 *Date:* ${humanDate}\n⏰ *Time:* ${inlineSlot}\n\nKya aap confirm karna chahenge? (*haan* / *yes* likhein ya *cancel* karein)`,
        confirmingState,
        waConfig,
      )
      return true
    }

    const humanDate = formatDateHuman(parsedDate)
    await sendSlotsAsButtons(
      updatedState,
      waConfig,
      futureSlots(parsedDate),
      `*${humanDate}* — Aap niche diye slots mein se koi time choose karein:`,
    )
    return true
  }

  // ── Step: COLLECTING_TIME ────────────────────────────────────────────────
  if (state.step === 'COLLECTING_TIME') {
    let chosenSlot: string | null = null

    // Button click — id format: "SLOT_11:00 AM"
    if (buttonId?.startsWith('SLOT_')) {
      chosenSlot = buttonId.replace('SLOT_', '')
    } else {
      chosenSlot = parseTimeToSlot(text)
    }

    if (!chosenSlot) {
      await sendSlotsAsButtons(
        state,
        waConfig,
        state.date ? futureSlots(state.date) : AVAILABLE_SLOTS,
        'Kripya niche diye buttons se time choose karein ya likhein (e.g. "11 AM", "2 baje"):',
      )
      return true
    }

    if (!state.date) {
      // Edge case: date was lost — restart
      await setBotState({ ...state, step: 'COLLECTING_DATE' })
      await sendBotReply('Ek minute — date phir se share karein please:', state, waConfig)
      return true
    }

    // Check slot availability
    const { available, suggestions } = await isSlotAvailable(state.date, chosenSlot)

    if (!available) {
      const humanDate = formatDateHuman(state.date)
      const suggestionText = suggestions.length > 0
        ? `Yeh slots available hain ${humanDate} ko:`
        : `Is din koi slot available nahi hai. Kripya doosra din choose karein:`

      if (suggestions.length > 0) {
        await sendSlotsAsButtons(state, waConfig, suggestions, suggestionText)
      } else {
        await setBotState({ ...state, step: 'COLLECTING_DATE' })
        await sendBotReply(
          `❌ *${chosenSlot}* ka time ${humanDate} ko nikal chuka hai.\n\n${suggestionText}`,
          state,
          waConfig,
        )
      }
      return true
    }

    // Slot is free — ask for confirmation
    const updatedState: BotState = { ...state, step: 'CONFIRMING', time: chosenSlot }
    await setBotState(updatedState)

    const humanDate = formatDateHuman(state.date)
    const confirmMsg =
      `✅ Slot available hai!\n\n` +
      `📅 *Date:* ${humanDate}\n` +
      `⏰ *Time:* ${chosenSlot}\n` +
      `👤 *Name:* ${state.contactName}\n\n` +
      `Kya aap confirm karna chahenge? (*haan* / *yes* likhein ya *cancel* karein)`

    await sendBotReply(confirmMsg, updatedState, waConfig)
    return true
  }

  // ── Step: CONFIRMING ─────────────────────────────────────────────────────
  if (state.step === 'CONFIRMING') {
    const isConfirmed = /\b(haan|ha|yes|yep|ok|okay|confirm|bilkul|zaroor|sure)\b/i.test(text)

    if (!isConfirmed) {
      await sendBotReply(
        'Appointment confirm karne ke liye *haan* ya *yes* likhein, ya *cancel* karein.',
        state,
        waConfig,
      )
      return true
    }

    if (!state.date || !state.time) {
      await clearBotState(ctx.conversationId)
      await sendBotReply(
        'Kuch technical gadbad ho gayi. Kripya dobara try karein. Maafi maangte hain! 🙏',
        state,
        waConfig,
      )
      return true
    }

    // Book into the same Contact/Appointment tables as the Call Center, with
    // the calling agent's identity and one-upcoming-visit rules
    // (app/api/appointments/create): phones are +91XXXXXXXXXX, and a customer
    // who already has an upcoming visit gets it moved rather than a second one.
    // This also keeps a retried Meta webhook from creating duplicates.
    const crmPhone = normalizeCustomerPhone(`+${state.contactPhone.replace(/\D/g, '')}`)
    const appointmentDate = new Date(`${state.date}T00:00:00.000Z`)
    const date = state.date
    const time = state.time
    const bookingNote = `Booked via WhatsApp chatbot by ${state.contactName} (${state.contactPhone})`
    let appointmentId: number | undefined
    // Assigned inside the transaction callback, so keep the full union type.
    let outcome = 'booked' as 'booked' | 'rescheduled' | 'already existed'
    try {
      if (!crmPhone) throw new Error(`unsupported phone number ${state.contactPhone}`)
      const today = indiaDateString()

      const appointment = await prisma.$transaction(async (tx) => {
        const contact = await tx.contact.upsert({
          where: { phone: crmPhone },
          update: {},
          create: { name: sanitizeCustomerName(state.contactName) || crmPhone, phone: crmPhone },
        })

        const upcoming = await tx.appointment.findFirst({
          where: {
            contactId: contact.id,
            status: 'Scheduled',
            deletedAt: null,
            date: { gte: new Date(`${today}T00:00:00Z`) },
          },
          orderBy: { date: 'asc' },
        })

        if (upcoming && !isPastAppointmentSlot(upcoming.date.toISOString().slice(0, 10), upcoming.time)) {
          if (upcoming.date.getTime() === appointmentDate.getTime() && upcoming.time === time) {
            outcome = 'already existed'
            return upcoming
          }
          outcome = 'rescheduled'
          return tx.appointment.update({
            where: { id: upcoming.id },
            data: {
              date: appointmentDate,
              time,
              status: 'Scheduled',
              notes: [upcoming.notes, `Rescheduled via WhatsApp chatbot by ${state.contactName} (${state.contactPhone})`]
                .filter(Boolean)
                .join('\n'),
            },
          })
        }

        return tx.appointment.create({
          data: {
            contactId: contact.id,
            date: appointmentDate,
            time,
            purpose: 'Showroom Visit',
            notes: bookingNote,
            status: 'Scheduled',
          },
        })
      }, { maxWait: 1000, timeout: 3000 })
      appointmentId = appointment.id
    } catch (err) {
      console.error('[appt-bot] appointment creation failed:', err)
      await clearBotState(ctx.conversationId)
      await sendBotReply(
        '❌ Appointment save karne mein error aayi. Kripya hume call karein: +91 97264 18181',
        state,
        waConfig,
      )
      return true
    }

    await clearBotState(ctx.conversationId)

    const humanDate = formatDateHuman(date)
    const confirmationMsg =
      `${outcome === 'rescheduled' ? '🔄 *Appointment Updated!*' : '🎉 *Appointment Confirmed!*'}\n\n` +
      `📅 *Date:* ${humanDate}\n` +
      `⏰ *Time:* ${time}\n` +
      `📍 *Location:* Sekol Tiles Showroom, Sartanpar Road, Morbi, Gujarat\n` +
      `👤 *Name:* ${state.contactName}\n\n` +
      `Hum aapka intezaar karenge! Koi sawaal ho toh call karein:\n` +
      `📞 +91 97264 18181 | +91 97264 18189\n\n` +
      `_Please ek din pehle confirm zaroor karein._`

    await sendBotReply(confirmationMsg, state, waConfig)

    console.log(
      `[appt-bot] appointment ${outcome} | id=${appointmentId} | contact=${state.contactId} | date=${date} | time=${time}`,
    )
    return true
  }

  return false
}
