import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import {
  normalizeAppointmentTime,
  normalizeCustomerPhone,
  indiaDateString,
  isSundayAppointmentDate,
  nextOpenAppointmentDate,
  resolveAppointmentDate,
  timeToMinutes,
  APPOINTMENT_SLOTS,
  isPastAppointmentSlot,
} from '@/lib/appointments/booking'

/**
 * POST /api/appointments/create
 * Called by the AI agent (Anushka) to book callbacks, showroom visits, and appointments.
 */
export async function POST(req: NextRequest) {
  const apiSecret = req.headers.get('x-api-secret')
  if (!process.env.CRM_API_SECRET || apiSecret !== process.env.CRM_API_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let bookingDate: string | null = null
  try {
    const body = await req.json()
    const {
      customerName, crmName, phone, crmPhone, providedPhone,
      date: rawDate, spokenDate, time: rawTime, purpose, notes, region, crmRegion,
    } = body
    const resolvedCustomerName = usableCustomerName(customerName) || usableCustomerName(crmName)

    if (!resolvedCustomerName || (!rawDate && !spokenDate) || !rawTime) {
      return NextResponse.json({ success: false, code: 'MISSING_DETAILS', error: 'Ask only for the missing customer name, date or time. Do not repeat details already collected.' })
    }
    const today = indiaDateString()
    const date = resolveAppointmentDate(rawDate, spokenDate, today)
    const time = normalizeAppointmentTime(rawTime)
    const normalizedPhone = normalizeCustomerPhone(phone) || normalizeCustomerPhone(crmPhone) || normalizeCustomerPhone(providedPhone)
    if (!date) {
      return NextResponse.json({
        success: false,
        code: 'INVALID_DATE',
        error: 'The date could not be resolved. Ask the customer for the date again, then retry.',
        currentIndiaDate: today,
        nextOpenDate: nextOpenAppointmentDate(today),
      })
    }
    if (isSundayAppointmentDate(date)) {
      return NextResponse.json({
        success: false,
        code: 'SUNDAY_CLOSED',
        error: 'Showroom appointments are not available on Sundays. Offer the next open date.',
        requestedDate: date,
        nextOpenDate: nextOpenAppointmentDate(date),
        availableSlots: APPOINTMENT_SLOTS,
      })
    }
    if (!time) {
      return NextResponse.json({
        success: false,
        code: 'INVALID_TIME',
        error: 'Ask the customer to choose one of the listed showroom slots.',
        availableSlots: APPOINTMENT_SLOTS,
      })
    }
    if (!normalizedPhone) {
      return NextResponse.json({ success: false, code: 'INVALID_PHONE', error: 'Caller ID is unavailable. Ask for a contact number once and retry with fallbackPhone; keep the other booking details.' })
    }
    if (isPastAppointmentSlot(date, time)) {
      return NextResponse.json({ success: false, code: 'PAST_SLOT', error: 'That time has already passed in India. Ask for a future slot.', currentIndiaDate: today, availableSlots: APPOINTMENT_SLOTS.filter(slot => !isPastAppointmentSlot(date, slot)), nextOpenDate: nextOpenAppointmentDate(date) })
    }
    bookingDate = date
    const customer = resolvedCustomerName.slice(0, 120)
    const appointmentPurpose = typeof purpose === 'string' && purpose.trim()
      ? purpose.trim().slice(0, 500) : 'Showroom Visit'
    const appointmentNotes = typeof notes === 'string' && notes.trim()
      ? notes.trim().slice(0, 2000) : 'Booked via AI Agent Anushka'

    const dayStart = new Date(`${date}T00:00:00.000Z`)
    const dayEnd = new Date(`${date}T23:59:59.999Z`)
    const appointment = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`customer:${normalizedPhone}`}))`
      const upcoming = await tx.appointment.findMany({
        where: { contact: { phone: normalizedPhone }, status: 'Scheduled', date: { gte: new Date(`${today}T00:00:00Z`) } },
        select: { id: true, date: true, time: true, purpose: true, region: true },
        orderBy: { date: 'asc' },
        take: 10,
      })
      const existingForCaller = upcoming.find(row => !isPastAppointmentSlot(row.date.toISOString().slice(0, 10), row.time))
      if (existingForCaller) {
        if (existingForCaller.date.toISOString().slice(0, 10) === date && existingForCaller.time === time) return existingForCaller
        const conflict = new Error('ALREADY_BOOKED') as Error & { appointment?: { id: number; date: string; time: string } }
        conflict.appointment = { id: existingForCaller.id, date: existingForCaller.date.toISOString().slice(0, 10), time: existingForCaller.time }
        throw conflict
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${date}:${time}`}))`
      const existingAppointments = await tx.appointment.findMany({
        where: { date: { gte: dayStart, lte: dayEnd }, status: { not: 'Cancelled' } },
        select: { time: true },
      })
      const requestedMinutes = timeToMinutes(time)
      const isTaken = existingAppointments.some((appointment) => {
        const bookedMinutes = timeToMinutes(appointment.time)
        return bookedMinutes !== null && requestedMinutes !== null && Math.abs(bookedMinutes - requestedMinutes) < 60
      })
      if (isTaken) {
        const error = new Error('APPOINTMENT_SLOT_TAKEN') as Error & { bookedTimes?: string[] }
        error.bookedTimes = existingAppointments.map((appointment) => appointment.time)
        throw error
      }

      // Upsert prevents an orphaned contact or a duplicate-phone race.
      const contact = await tx.contact.upsert({
        where: { phone: normalizedPhone },
        update: { name: customer },
        create: { name: customer, phone: normalizedPhone },
      })
      // The transaction advisory lock serializes requests for this fixed slot.
      return tx.appointment.create({
        data: {
          contactId: contact.id,
          date: new Date(date),
          time,
          purpose: appointmentPurpose,
          region: firstText(crmRegion, region)?.slice(0, 120) || null,
          notes: appointmentNotes,
          status: 'Scheduled',
        },
      })
    }, { maxWait: 1500, timeout: 4000 })

    return NextResponse.json({
      success: true,
      data: {
        id: appointment.id,
        date,
        time,
        purpose: appointment.purpose,
        region: appointment.region,
      },
    })
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'ALREADY_BOOKED') {
      return NextResponse.json({ success: false, code: 'ALREADY_BOOKED', data: (error as Error & { appointment?: unknown }).appointment,
        error: 'This customer already has an upcoming appointment. Tell them its date/time. No new booking was made; offer human help for rescheduling.',
      })
    }
    if (error instanceof Error && error.message === 'APPOINTMENT_SLOT_TAKEN') {
      return slotTakenResponse((error as Error & { bookedTimes?: string[] }).bookedTimes || [], bookingDate)
    }
    if (isUniqueConstraintError(error) && bookingDate) {
      const existing = await prisma.appointment.findMany({
        where: { date: { gte: new Date(`${bookingDate}T00:00:00.000Z`), lte: new Date(`${bookingDate}T23:59:59.999Z`) }, status: { not: 'Cancelled' } },
        select: { time: true },
      })
      return slotTakenResponse(existing.map((appointment) => appointment.time), bookingDate)
    }
    console.error('Failed to create appointment:', error)
    return NextResponse.json({ success: false, code: 'BOOKING_UNAVAILABLE', error: 'Booking could not be confirmed. Tell the caller briefly; retry the same details once. If it fails again, offer a human transfer or callback with consent.' }, { status: 500 })
  }
}

function slotTakenResponse(bookedTimes: string[], date: string | null) {
  const bookedMinutes = bookedTimes.map(timeToMinutes).filter((minutes): minutes is number => minutes !== null)
  const suggestions = APPOINTMENT_SLOTS.filter((slot) => {
    if (date && isPastAppointmentSlot(date, slot)) return false
    const slotMinutes = timeToMinutes(slot)
    return slotMinutes !== null && !bookedMinutes.some((booked) => Math.abs(booked - slotMinutes) < 60)
  }).slice(0, 4)
  return NextResponse.json({ success: false, code: 'SLOT_TAKEN', error: 'That slot was just booked.', available: false, suggestions })
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002'
}

function usableCustomerName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim()
  if (!name || /^(customer|unknown(?: customer)?)$/i.test(name) || name.includes('{{')) return null
  return name
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) if (typeof value === 'string' && value.trim() && !value.includes('{{')) return value.trim()
  return null
}
