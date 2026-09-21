import { NextRequest, NextResponse } from 'next/server'
import { getCurrentAdmin } from '@/lib/auth'
import { buildSekolDograhPrompt } from '@/lib/calling-agent/prompt.mjs'
import { dograhUsesAri, updateDograhAgentPrompt, updateDograhHumanTransferDestination } from '@/lib/dograh'
import { prisma } from '@/lib/db'
import { getRegionPricing } from '@/lib/region-pricing'

function normalizeE164(value: unknown) {
  if (typeof value !== 'string') return null
  const normalized = value.replace(/[\s().-]/g, '')
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : null
}

export async function GET() {
  const user = await getCurrentAdmin()
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 })

  return NextResponse.json({
    success: true,
    settings: { transferPhone: user.transferPhone },
  })
}

export async function PATCH(request: NextRequest) {
  const user = await getCurrentAdmin()
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 })

  try {
    const body = await request.json()
    const transferPhone = normalizeE164(body?.transferPhone)
    if (!transferPhone) {
      return NextResponse.json(
        { success: false, error: 'Enter a valid E.164 number, for example +919726418181.' },
        { status: 400 },
      )
    }

    const liveTransferEnabled = dograhUsesAri()
    if (liveTransferEnabled) {
      await updateDograhHumanTransferDestination(transferPhone)
    }
    // Publish after the transfer destination, so a successful dashboard update
    // always leaves the agent prompt and live handoff routing in sync.
    await updateDograhAgentPrompt(buildSekolDograhPrompt(transferPhone, {
      liveTransferEnabled,
      regionPricing: await getRegionPricing(),
    }))
    await prisma.adminUser.update({ where: { id: user.id }, data: { transferPhone } })

    return NextResponse.json({ success: true, settings: { transferPhone } })
  } catch (error) {
    console.error('Call handling settings update failed:', error)
    return NextResponse.json(
      { success: false, error: 'Could not update the live agent. Please try again.' },
      { status: 502 },
    )
  }
}
