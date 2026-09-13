import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { normalizeCustomerPhone } from '@/lib/appointments/booking'

/**
 * POST /api/calls/schedule-callback
 * Called by the AI agent when a customer requests a callback.
 * Creates a call log entry with the callback details.
 */
export async function POST(req: NextRequest) {
  const apiSecret = req.headers.get('x-api-secret')
  if (!process.env.CRM_API_SECRET || apiSecret !== process.env.CRM_API_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { customerName, phone, fallbackPhone, preferredTime, reason, region } = await req.json()
    const normalizedPhone = normalizeCustomerPhone(phone) || normalizeCustomerPhone(fallbackPhone)
    if (!normalizedPhone) return NextResponse.json({ success: false, code: 'INVALID_PHONE', error: 'Ask for a contact number once and retry using fallbackPhone.' })
    if (
      typeof customerName !== 'string' || !customerName.trim() ||
      typeof preferredTime !== 'string' || !preferredTime.trim()
    ) {
      return NextResponse.json({ success: false, code: 'MISSING_DETAILS', error: 'Ask only for the missing customer name or preferred callback time.' })
    }

    // Try to link to existing contact
    const contact = await prisma.contact.findFirst({ where: { phone: normalizedPhone } })

    const now = new Date()

    const callLog = await prisma.callLog.create({
      data: {
        contactId: contact?.id,
        customerName: customerName.trim().slice(0, 120),
        phone: normalizedPhone,
        direction: 'OUTBOUND',
        status: 'QUEUED',
        duration: '0:00',
        durationSec: 0,
        agent: 'AI Agent - Anushka',
        date: now,
        time: now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }),
        purpose: `Callback requested: ${reason || 'General'}`,
        region: typeof region === 'string' && region.trim() ? region.trim().slice(0, 120) : null,
        outcome: 'Callback Scheduled',
        notes: `Customer requested callback at ${preferredTime.trim().slice(0, 200)}. Reason: ${typeof reason === 'string' ? reason.slice(0, 500) : 'General'}`,
        recording: false,
        callType: 'callback_request',
        aiHandled: true,
      },
    })

    return NextResponse.json({ success: true, data: { id: callLog.id } })
  } catch (error) {
    console.error('Failed to schedule callback:', error)
    return NextResponse.json({ error: 'Failed to schedule callback' }, { status: 500 })
  }
}
