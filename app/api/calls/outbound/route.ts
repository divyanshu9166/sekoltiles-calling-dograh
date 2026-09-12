import { NextRequest, NextResponse } from 'next/server'
import { outboundAICallSchema } from '@/lib/validations/ai-call'
import { getCurrentAdmin } from '@/lib/auth'

/**
 * POST /api/calls/outbound
 * Triggers an outbound AI call through a published Dograh workflow.
 * Called from the CRM frontend when a user clicks "AI Call" button.
 */
export async function POST(req: NextRequest) {
  try {
    if (!await getCurrentAdmin()) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const body = await req.json()
    const parsed = outboundAICallSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }
    const { phoneNumber, reason, customerName, region } = parsed.data

    const DOGRAH_API_URL = process.env.DOGRAH_API_URL
    const DOGRAH_API_KEY = process.env.DOGRAH_API_KEY
    const DOGRAH_WORKFLOW_UUID = process.env.DOGRAH_WORKFLOW_UUID

    if (!DOGRAH_API_URL || !DOGRAH_API_KEY || !DOGRAH_WORKFLOW_UUID) {
      return NextResponse.json(
        { error: 'Dograh not configured. Please set DOGRAH_API_URL, DOGRAH_API_KEY, and DOGRAH_WORKFLOW_UUID.' },
        { status: 503 }
      )
    }

    const { startOutboundAICall } = await import('@/lib/calling-agent/outbound')
    const { dograhRunId, callLogId } = await startOutboundAICall({
      phoneNumber,
      reason: reason || 'Follow-up call',
      customerName: customerName || '',
      region: region || '',
    })

    return NextResponse.json({
      success: true,
      data: {
        dograhRunId,
        callLogId,
        message: `Call queued for ${phoneNumber}`,
      },
    })
  } catch (error) {
    console.error('Failed to initiate outbound call:', error)
    return NextResponse.json({ error: 'Failed to initiate call' }, { status: 500 })
  }
}
