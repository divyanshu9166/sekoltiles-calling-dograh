import { NextRequest, NextResponse } from 'next/server'
import { getCurrentAdmin } from '@/lib/auth'
import { prisma } from '@/lib/db'

type CampaignRouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, context: CampaignRouteContext) {
  if (!await getCurrentAdmin()) return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 })
  const id = Number((await context.params).id)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ success: false, error: 'Invalid campaign.' }, { status: 400 })

  try {
    const { action } = await request.json()
    const campaign = await prisma.marketingCampaign.findUnique({
      where: { id },
      include: { _count: { select: { leads: { where: { status: 'PENDING' } } } } },
    })
    if (!campaign) return NextResponse.json({ success: false, error: 'Campaign not found.' }, { status: 404 })

    if (action === 'pause') {
      if (campaign.status !== 'RUNNING') {
        return NextResponse.json({ success: false, error: 'Only a running campaign can be paused.' }, { status: 400 })
      }
      const updated = await prisma.marketingCampaign.update({ where: { id }, data: { status: 'PAUSED' } })
      return NextResponse.json({ success: true, campaign: updated })
    }

    if (action === 'start' || action === 'resume') {
      if (!campaign._count.leads) {
        return NextResponse.json({ success: false, error: 'This campaign has no pending contacts.' }, { status: 400 })
      }
      const updated = await prisma.marketingCampaign.update({
        where: { id },
        data: {
          status: 'RUNNING',
          startedAt: campaign.startedAt || new Date(),
          completedAt: null,
          nextCallAt: new Date(),
        },
      })
      return NextResponse.json({ success: true, campaign: updated })
    }

    return NextResponse.json({ success: false, error: 'Unsupported campaign action.' }, { status: 400 })
  } catch (error) {
    console.error('Campaign control failed:', error)
    return NextResponse.json({ success: false, error: 'Campaign action failed.' }, { status: 500 })
  }
}
