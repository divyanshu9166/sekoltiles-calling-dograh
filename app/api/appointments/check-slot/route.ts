import { NextRequest, NextResponse } from 'next/server'
import {
  APPOINTMENT_SLOTS,
  normalizeAppointmentDate,
  normalizeAppointmentTime,
  isSundayAppointmentDate,
  nextOpenAppointmentDate,
  isPastAppointmentSlot,
} from '@/lib/appointments/booking'

/**
 * GET /api/appointments/check-slot?date=YYYY-MM-DD&time=HH:MM+AM
 *
 * Validates showroom hours. Multiple customers may book the same time.
 *
 * Returns:
 *   { available: true }
 *   { available: false, suggestions: ["10:00 AM", "2:00 PM", ...] }
 *
 * Called by:
 *   - AI calling agent (Anushka) before confirming appointment on call
 *   - WhatsApp appointment chatbot after customer picks a time
 */

export async function GET(req: NextRequest) {
  const apiSecret = req.headers.get('x-api-secret')
  if (!process.env.CRM_API_SECRET || apiSecret !== process.env.CRM_API_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const dateStr = searchParams.get('date')   // e.g. "2026-06-10"
  const timeStr = searchParams.get('time')   // e.g. "11:00 AM"

  if (!dateStr || !timeStr) {
    return NextResponse.json(
      { error: 'date and time query parameters are required' },
      { status: 400 },
    )
  }

  // Parse date — accept YYYY-MM-DD
  const date = normalizeAppointmentDate(dateStr)
  if (!date) return NextResponse.json({ error: 'Use a real current or future date in YYYY-MM-DD format.' }, { status: 400 })
  if (isSundayAppointmentDate(date)) {
    return NextResponse.json({
      available: false,
      reason: 'SUNDAY_CLOSED',
      error: 'Showroom appointments are not available on Sundays.',
      nextOpenDate: nextOpenAppointmentDate(date),
      suggestions: APPOINTMENT_SLOTS.slice(0, 4),
    })
  }
  const time = normalizeAppointmentTime(timeStr)
  if (!time) {
    return NextResponse.json(
      { error: 'Choose a time between 9:00 AM and 5:00 PM.' },
      { status: 400 },
    )
  }
  if (isPastAppointmentSlot(date, time)) return NextResponse.json({ available: false, reason: 'PAST_SLOT', suggestions: APPOINTMENT_SLOTS.filter(slot => !isPastAppointmentSlot(date, slot)) })
  return NextResponse.json({ available: true })
}
