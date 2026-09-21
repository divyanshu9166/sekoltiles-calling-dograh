import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentAdmin } from '@/lib/auth'
import { buildSekolDograhPrompt } from '@/lib/calling-agent/prompt.mjs'
import { dograhUsesAri, updateDograhAgentPrompt } from '@/lib/dograh'
import { prisma } from '@/lib/db'
import { getRegionPricing } from '@/lib/region-pricing'

const priceRowSchema = z.object({
  region: z.string().trim().min(2).max(120),
  price12x18: z.coerce.number().int().positive().max(1_000_000),
  price12x24: z.coerce.number().int().positive().max(1_000_000),
})

const pricingSchema = z.object({
  regions: z.array(priceRowSchema).min(1).max(50),
})

export async function GET() {
  const user = await getCurrentAdmin()
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 })

  return NextResponse.json({ success: true, regions: await getRegionPricing() })
}

export async function PATCH(request: NextRequest) {
  const user = await getCurrentAdmin()
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 })

  try {
    const parsed = pricingSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Add at least one valid region and positive whole-number prices for both tile sizes.' },
        { status: 400 },
      )
    }

    const regions = parsed.data.regions.map((item) => ({
      region: item.region.replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' '),
      price12x18: item.price12x18,
      price12x24: item.price12x24,
    }))
    const normalizedNames = regions.map((item) => item.region.toLocaleLowerCase('en-IN'))
    if (new Set(normalizedNames).size !== normalizedNames.length) {
      return NextResponse.json({ success: false, error: 'Each region/zone must be unique.' }, { status: 400 })
    }

    await updateDograhAgentPrompt(buildSekolDograhPrompt(user.transferPhone, {
      liveTransferEnabled: dograhUsesAri(),
      regionPricing: regions,
    }))

    await prisma.$transaction(async (tx) => {
      await tx.regionPricing.deleteMany()
      await tx.regionPricing.createMany({
        data: regions.map((item, sortOrder) => ({ ...item, sortOrder })),
      })
    })

    return NextResponse.json({ success: true, regions })
  } catch (error) {
    console.error('Region pricing update failed:', error)
    return NextResponse.json(
      { success: false, error: 'Could not publish region pricing to the live agent. Existing pricing was not changed.' },
      { status: 502 },
    )
  }
}
