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
} from '@/lib/appointments/booking'

/**
 * POST /api/appointments/create
 * Called by the AI agent (Anushka) to book callbacks, showroom visits, and appointments.
 */
export async function POST(req: NextRequest) {
  const apiSecret = req.headers.get('x-api-secret')
  if (apiSecret !== process.env.CRM_API_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let bookingDate: string | null = null
  try {
    const body = await req.json()
    const { customerName, phone, date: rawDate, spokenDate, time: rawTime, purpose, notes, region } = body

    if (typeof customerName !== 'string' || !customerName.trim() || !phone || !rawDate || !rawTime) {
      return NextResponse.json({ success: false, error: 'customerName, phone, date, and time are required' })
    }
    const today = indiaDateString()
    const date = resolveAppointmentDate(rawDate, spokenDate, today)
    const time = normalizeAppointmentTime(rawTime)
    const normalizedPhone = normalizeCustomerPhone(phone)
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
      return NextResponse.json({ success: false, code: 'INVALID_PHONE', error: 'The supplied caller phone is invalid.' })
    }
    bookingDate = date
    const customer = customerName.trim().slice(0, 120)
    const appointmentPurpose = typeof purpose === 'string' && purpose.trim()
      ? purpose.trim().slice(0, 500) : 'Showroom Visit'
    const appointmentNotes = typeof notes === 'string' && notes.trim()
      ? notes.trim().slice(0, 2000) : 'Booked via AI Agent Anushka'

    const dayStart = new Date(`${date}T00:00:00.000Z`)
    const dayEnd = new Date(`${date}T23:59:59.999Z`)
    const appointment = await prisma.$transaction(async (tx) => {
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
      // The [date,time] database constraint is the final authority if another
      // request passes the availability check at the same moment.
      return tx.appointment.create({
        data: {
          contactId: contact.id,
          date: new Date(date),
          time,
          purpose: appointmentPurpose,
          region: typeof region === 'string' && region.trim() ? region.trim().slice(0, 120) : null,
          notes: appointmentNotes,
          status: 'Scheduled',
        },
      })
    })

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
    if (error instanceof Error && error.message === 'APPOINTMENT_SLOT_TAKEN') {
      return slotTakenResponse((error as Error & { bookedTimes?: string[] }).bookedTimes || [])
    }
    if (isUniqueConstraintError(error) && bookingDate) {
      const existing = await prisma.appointment.findMany({
        where: { date: { gte: new Date(`${bookingDate}T00:00:00.000Z`), lte: new Date(`${bookingDate}T23:59:59.999Z`) }, status: { not: 'Cancelled' } },
        select: { time: true },
      })
      return slotTakenResponse(existing.map((appointment) => appointment.time))
    }
    console.error('Failed to create appointment:', error)
    return NextResponse.json({ error: 'Failed to create appointment' }, { status: 500 })
  }
}

function slotTakenResponse(bookedTimes: string[]) {
  const bookedMinutes = bookedTimes.map(timeToMinutes).filter((minutes): minutes is number => minutes !== null)
  const suggestions = APPOINTMENT_SLOTS.filter((slot) => {
    const slotMinutes = timeToMinutes(slot)
    return slotMinutes !== null && !bookedMinutes.some((booked) => Math.abs(booked - slotMinutes) < 60)
  }).slice(0, 4)
  return NextResponse.json({ success: false, code: 'SLOT_TAKEN', error: 'That slot was just booked.', available: false, suggestions })
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002'
}
