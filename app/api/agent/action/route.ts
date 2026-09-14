import { NextRequest, NextResponse } from 'next/server'
import { POST as checkAppointments } from '@/app/api/appointments/existing/route'
import { POST as bookAppointment } from '@/app/api/appointments/create/route'
import { POST as requestCallback } from '@/app/api/calls/schedule-callback/route'

const actions = {
  check: checkAppointments,
  book: bookAppointment,
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
