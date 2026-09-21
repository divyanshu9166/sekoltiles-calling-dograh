import { NextRequest, NextResponse } from 'next/server'
import { POST as checkAppointments } from '@/app/api/appointments/existing/route'
import { POST as bookAppointment } from '@/app/api/appointments/create/route'
import { POST as requestCallback } from '@/app/api/calls/schedule-callback/route'
import { isCatalogueMisroutedToAppointment } from '@/lib/calling-agent/customer-action-guard.mjs'

const actions = {
  check: checkAppointments,
  book: bookAppointment,
  reschedule: bookAppointment,
  callback: requestCallback,
} as const

/** One compact LLM tool entry point; business logic stays in the existing routes. */
export async function POST(req: NextRequest) {
  if (!process.env.CRM_API_SECRET || req.headers.get('x-api-secret') !== process.env.CRM_API_SECRET) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, code: 'INVALID_ACTION', error: 'Invalid request.' }, { status: 400 })
  }

  const action = typeof body.action === 'string' ? body.action.toLowerCase() : ''
  if (isCatalogueMisroutedToAppointment(body)) {
    return NextResponse.json({
      success: false,
      code: 'CATALOGUE_NOT_APPOINTMENT',
      instruction: 'This is a catalogue request, not an appointment. Do not ask for name, date, or time and do not call customer_action. Acknowledge the catalogue request using the configured catalogue follow-up, then ask whether they want a human agent.',
    })
  }
  const handler = actions[action as keyof typeof actions]
  if (!handler) {
    return NextResponse.json({ success: false, code: 'INVALID_ACTION', error: 'Use check, book, or callback.' }, { status: 400 })
  }

  const forwarded = new NextRequest(req.url, {
    method: 'POST',
    headers: req.headers,
    body: JSON.stringify(body),
  })
  return handler(forwarded)
}
