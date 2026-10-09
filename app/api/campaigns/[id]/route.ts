import { NextRequest, NextResponse } from 'next/server'
import { getCurrentAdmin } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { validateCampaignSchedule, campaignScheduleActivation, campaignScheduleDisplay } from '@/lib/campaigns/schedule.mjs'

type CampaignRouteContext = { params: Promise<{ id: string }> }

function campaignId(value: string) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

export async function GET(_request: NextRequest, context: CampaignRouteContext) {
  if (!await getCurrentAdmin()) return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 })
  const id = campaignId((await context.params).id)
  if (!id) return NextResponse.json({ success: false, error: 'Invalid campaign.' }, { status: 400 })

  const [campaign, leads, groupedCounts] = await Promise.all([
    prisma.marketingCampaign.findUnique({ where: { id } }),
    prisma.campaignLead.findMany({ where: { campaignId: id }, orderBy: { id: 'asc' }, take: 250 }),
    prisma.campaignLead.groupBy({ where: { campaignId: id }, by: ['status'], _count: { _all: true } }),
  ])
  if (!campaign) return NextResponse.json({ success: false, error: 'Campaign not found.' }, { status: 404 })
  const counts = Object.fromEntries(groupedCounts.map(row => [row.status, row._count._all]))
  return NextResponse.json({ success: true, campaign: {
    ...campaign, leads, counts, visibleLeadLimit: 250,
    callingSchedule: campaignScheduleDisplay(campaign, counts.CALLING || 0),
  } })
}

export async function PATCH(request: NextRequest, context: CampaignRouteContext) {
  if (!await getCurrentAdmin()) return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 })
  const id = campaignId((await context.params).id)
  if (!id) return NextResponse.json({ success: false, error: 'Invalid campaign.' }, { status: 400 })

  try {
    const body = await request.json()
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const instructions = typeof body?.instructions === 'string' ? body.instructions.trim() : ''
    const delayValue = Number(body?.interCallDelaySec)
    if (name.length < 3 || name.length > 120) {
      return NextResponse.json({ success: false, error: 'Campaign name must be 3–120 characters.' }, { status: 400 })
    }
    if (instructions.length < 10 || instructions.length > 2000) {
      return NextResponse.json({ success: false, error: 'Campaign instructions must be 10–2000 characters.' }, { status: 400 })
    }
    const interCallDelaySec = Number.isFinite(delayValue) ? Math.max(5, Math.min(300, Math.round(delayValue))) : 15
    const existing = await prisma.marketingCampaign.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ success: false, error: 'Campaign not found.' }, { status: 404 })
    let schedule
    try {
      schedule = validateCampaignSchedule({
        callingStartTime: body.callingStartTime === undefined ? existing.callingStartTime : body.callingStartTime,
        callingEndTime: body.callingEndTime === undefined ? existing.callingEndTime : body.callingEndTime,
        autoResumeDaily: body.autoResumeDaily === undefined ? existing.autoResumeDaily : body.autoResumeDaily,
      })
    } catch (error) {
      return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Invalid calling schedule.' }, { status: 400 })
    }
    const scheduleChanged = schedule.callingStartTime !== existing.callingStartTime
      || schedule.callingEndTime !== existing.callingEndTime || schedule.autoResumeDaily !== existing.autoResumeDaily
    const activation = scheduleChanged
      ? existing.status === 'RUNNING' ? campaignScheduleActivation(schedule) : { scheduleStopAt: null }
      : {}
    const campaign = await prisma.marketingCampaign.update({
      where: { id },
      data: { name, instructions, interCallDelaySec, ...schedule, ...activation },
    })
    return NextResponse.json({ success: true, campaign })
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2025') {
      return NextResponse.json({ success: false, error: 'Campaign not found.' }, { status: 404 })
    }
    console.error('Campaign update failed:', error)
    return NextResponse.json({ success: false, error: 'Campaign could not be updated.' }, { status: 500 })
  }
}
