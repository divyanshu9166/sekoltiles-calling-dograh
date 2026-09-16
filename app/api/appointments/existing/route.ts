import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { indiaDateString, isPastAppointmentSlot, normalizeCustomerPhone, resolveCustomerPhone, timeToMinutes } from '@/lib/appointments/booking'

export async function POST(req: NextRequest) {
  if (!process.env.CRM_API_SECRET || req.headers.get('x-api-secret') !== process.env.CRM_API_SECRET) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const body = await req.json()
    const { direction, phone, crmPhone, providedPhone, fallbackPhone, calledNumber } = body
    const normalizedPhone = resolveCustomerPhone({ direction, crmPhone, calledNumber, phone, providedPhone, fallbackPhone })
    if (!normalizedPhone) return NextResponse.json({ success: false, code: 'INVALID_PHONE', error: 'Ask for a contact number once, then retry using fallbackPhone.' })
    const now = new Date()
    const today = indiaDateString(now)
    const rows = await prisma.appointment.findMany({
      where: { contact: { phone: normalizedPhone }, status: 'Scheduled', date: { gte: new Date(`${today}T00:00:00Z`) } },
      select: { id: true, date: true, time: true },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
      // A caller should never accumulate many active bookings, but bounding
      // the read keeps this real-time voice tool predictable on dirty data.
      take: 10,
    })
    const appointments = rows.map(row => ({ ...row, date: row.date.toISOString().slice(0, 10) }))
      .filter(row => !isPastAppointmentSlot(row.date, row.time, now))
      .sort((a, b) => a.date.localeCompare(b.date) || (timeToMinutes(a.time) ?? 0) - (timeToMinutes(b.time) ?? 0))
      .slice(0, 3)
    return NextResponse.json({ success: true, currentIndiaDate: today, timeZone: 'Asia/Kolkata', hasAppointment: appointments.length > 0, appointments,
      instruction: appointments.length ? 'Tell the caller their existing date/time. Ask whether to keep it or reschedule. If they want to change the date or time, call customer_action with action=reschedule.' : 'No upcoming scheduled appointment found. Ask only for the next missing booking detail.',
    })
  } catch {
    return NextResponse.json({ success: false, code: 'LOOKUP_UNAVAILABLE', error: 'Could not check existing bookings. Do not claim there are none. Offer human help or retry once.' }, { status: 503 })
  }
}
