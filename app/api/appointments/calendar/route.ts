import { NextRequest, NextResponse } from 'next/server'
import { APPOINTMENT_SLOTS, addIndiaCalendarDays, indiaDateString, isPastAppointmentSlot, isSundayAppointmentDate } from '@/lib/appointments/booking'

// Read-only clock for inbound calls: never bake today's date into a published prompt.
export async function GET(req: NextRequest) {
  if (!process.env.CRM_API_SECRET || req.headers.get('x-api-secret') !== process.env.CRM_API_SECRET) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  const now = new Date()
  const today = indiaDateString(now)
  return NextResponse.json({
    success: true,
    currentIndiaDate: today,
    timeZone: 'Asia/Kolkata',
    dates: Array.from({ length: 14 }, (_, offset) => {
      const date = addIndiaCalendarDays(today, offset)
      const closed = isSundayAppointmentDate(date)
      return {
        date,
        weekday: new Intl.DateTimeFormat('en-IN', { weekday: 'long', timeZone: 'Asia/Kolkata' }).format(new Date(`${date}T12:00:00+05:30`)),
        closed,
        slots: closed ? [] : APPOINTMENT_SLOTS.filter(time => !isPastAppointmentSlot(date, time, now)),
      }
    }),
    instruction: 'These are business hours, not reserved availability. Ask only for the next missing detail. Booking is confirmed only by the booking tool.',
  }, { headers: { 'Cache-Control': 'no-store' } })
}
