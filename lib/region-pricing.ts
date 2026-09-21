import 'server-only'

import { prisma } from '@/lib/db'
import { DEFAULT_REGION_PRICING } from '@/lib/calling-agent/prompt.mjs'

export type RegionPrice = {
  region: string
  price12x18: number
  price12x24: number
}

export async function getRegionPricing(): Promise<RegionPrice[]> {
  const rows = await prisma.regionPricing.findMany({
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: { region: true, price12x18: true, price12x24: true },
  })
  return rows.length ? rows : DEFAULT_REGION_PRICING.map((item) => ({ ...item }))
}
