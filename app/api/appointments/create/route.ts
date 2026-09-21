import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import {
  normalizeAppointmentTime,
  normalizeCustomerPhone,
  resolveCustomerPhone,
  indiaDateString,
  isSundayAppointmentDate,
  nextOpenAppointmentDate,
  resolveAppointmentDate,
  APPOINTMENT_SLOTS,
  isPastAppointmentSlot,
  sanitizeCustomerName,
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

  try {
    const body = await req.json()
    const {
      customerName, crmName, phone, crmPhone, providedPhone, direction,
      date: rawDate, spokenDate, time: rawTime, purpose, notes, region, crmRegion,
    } = body
    const resolvedCustomerName = usableCustomerName(customerName) || usableCustomerName(crmName)

    if (!resolvedCustomerName || (!rawDate && !spokenDate) || !rawTime) {
      return NextResponse.json({ success: false, code: 'MISSING_DETAILS', error: 'Ask only for the missing customer name, date or time. Do not repeat details already collected.' })
    }
    const today = indiaDateString()
    const date = resolveAppointmentDate(rawDate, spokenDate, today)
    const time = normalizeAppointmentTime(rawTime)
    const normalizedPhone = resolveCustomerPhone({ direction, crmPhone, calledNumber: body.calledNumber, phone, providedPhone, fallbackPhone: body.fallbackPhone })
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
        error: 'Ask for a time between 9:00 AM and 5:00 PM.',
        availableSlots: APPOINTMENT_SLOTS,
      })
    }
    if (!normalizedPhone) {
      return NextResponse.json({ success: false, code: 'INVALID_PHONE', error: 'Caller ID is unavailable. Ask for a contact number once and retry with fallbackPhone; keep the other booking details.' })
    }
    if (isPastAppointmentSlot(date, time)) {
      return NextResponse.json({ success: false, code: 'PAST_SLOT', error: 'That time has already passed in India. Ask for a future slot.', currentIndiaDate: today, availableSlots: APPOINTMENT_SLOTS.filter(slot => !isPastAppointmentSlot(date, slot)), nextOpenDate: nextOpenAppointmentDate(date) })
    }
    // Fast pre-check: does this customer already have an upcoming appointment?
    const existingForCaller = await prisma.appointment.findFirst({
      where: { contact: { phone: normalizedPhone }, status: 'Scheduled', date: { gte: new Date(`${today}T00:00:00Z`) } },
      select: { id: true, date: true, time: true, purpose: true, region: true },
      orderBy: { date: 'asc' },
    })
    if (existingForCaller && !isPastAppointmentSlot(existingForCaller.date.toISOString().slice(0, 10), existingForCaller.time)) {
      const exDate = existingForCaller.date.toISOString().slice(0, 10)
      if (exDate === date && existingForCaller.time === time) {
        return NextResponse.json({
          success: true,
          alreadyBooked: true,
          data: { id: existingForCaller.id, date, time, purpose: existingForCaller.purpose ?? 'Showroom Visit', region: existingForCaller.region },
          instruction: 'The appointment is already scheduled for this exact slot. Say exactly: "आपकी appointment पहले से इसी समय पर बुक है, धन्यवाद!" and immediately call end_call tool in the SAME turn.',
        })
      }
      // If date or time differs: customer requested a different slot.
      // Automatically update/reschedule the existing appointment in the transaction below.
    }
    const customer = resolvedCustomerName.slice(0, 120)
    const appointmentPurpose = typeof purpose === 'string' && purpose.trim()
      ? purpose.trim().slice(0, 500) : 'Showroom Visit'
    const appointmentNotes = typeof notes === 'string' && notes.trim()
      ? notes.trim().slice(0, 2000) : 'Booked via AI Agent Anushka'

    const appointment = await prisma.$transaction(async (tx) => {
      if (existingForCaller) {
        return tx.appointment.update({
          where: { id: existingForCaller.id },
          data: {
            date: new Date(date),
            time,
            purpose: appointmentPurpose,
            region: firstText(crmRegion, region)?.slice(0, 120) || null,
            notes: appointmentNotes,
            status: 'Scheduled',
          },
        })
      }

      // Upsert prevents an orphaned contact or a duplicate-phone race.
      const contact = await tx.contact.upsert({
        where: { phone: normalizedPhone },
        update: { name: customer },
        create: { name: customer, phone: normalizedPhone },
      })
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
    }, { maxWait: 1000, timeout: 3000 })

    const isUpdated = Boolean(existingForCaller)
    return NextResponse.json({
      success: true,
      rescheduled: isUpdated,
      data: {
        id: appointment.id,
        date,
        time,
        purpose: appointment.purpose,
        region: appointment.region,
      },
      message: isUpdated ? 'Appointment rescheduled successfully.' : 'Appointment booked successfully.',
      instruction: isUpdated
        ? 'Appointment updated. Say exactly: "आपकी appointment अपडेट हो चुकी है, धन्यवाद!" and immediately call end_call tool in the SAME turn. Do not ask any question and do not offer human transfer.'
        : 'Appointment confirmed. Say exactly: "आपका अपॉइंटमेंट बुक हो गया है, धन्यवाद।" and immediately call end_call tool in the SAME turn. Do not ask any question and do not offer human transfer.',
    })
  } catch (error: unknown) {
    console.error('Failed to create appointment:', error)
    return NextResponse.json({ success: false, code: 'BOOKING_UNAVAILABLE', error: 'Booking could not be confirmed. Tell the caller briefly; retry the same details once. If it fails again, offer a human transfer or callback with consent.' }, { status: 500 })
  }
}

function usableCustomerName(value: unknown): string | null {
  const name = sanitizeCustomerName(value)
  return name || null
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) if (typeof value === 'string' && value.trim() && !value.includes('{{')) return value.trim()
  return null
}
