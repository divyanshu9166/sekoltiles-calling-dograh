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

    if (action === 'retry_failed') {
      if (campaign.status !== 'COMPLETED') {
        return NextResponse.json({ success: false, error: 'Finish the campaign before calling failed contacts again.' }, { status: 400 })
      }
      const failedCount = await prisma.campaignLead.count({ where: { campaignId: id, status: 'FAILED' } })
      if (!failedCount) {
        return NextResponse.json({ success: false, error: 'This campaign has no failed contacts.' }, { status: 400 })
      }

      const now = new Date()
      const result = await prisma.$transaction(async tx => {
        const reopened = await tx.marketingCampaign.updateMany({
          where: { id, status: 'COMPLETED' },
          data: { status: 'RUNNING', startedAt: now, completedAt: null, nextCallAt: now },
        })
        if (!reopened.count) return null

        const retried = await tx.campaignLead.updateMany({
          where: { campaignId: id, status: 'FAILED' },
          data: {
            status: 'PENDING', startedAt: null, completedAt: null,
            outcome: null, lastError: null, callLogId: null, dograhRunId: null,
          },
        })
        if (!retried.count) throw new Error('Failed contacts changed before retry.')
        const updated = await tx.marketingCampaign.findUnique({ where: { id } })
        return { campaign: updated, retried: retried.count }
      })
      if (!result) {
        return NextResponse.json({ success: false, error: 'Campaign has already been restarted.' }, { status: 409 })
      }
      return NextResponse.json({ success: true, ...result })
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
