import { NextRequest, NextResponse } from 'next/server'
import { getCurrentAdmin } from '@/lib/auth'
import { importCampaignFile, importGoogleSheet } from '@/lib/campaigns/import'
import { prisma } from '@/lib/db'

export async function GET() {
  if (!await getCurrentAdmin()) return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 })

  const [campaigns, groupedCounts] = await Promise.all([
    prisma.marketingCampaign.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.campaignLead.groupBy({ by: ['campaignId', 'status'], _count: { _all: true } }),
  ])
  const counts = new Map<number, Record<string, number>>()
  for (const row of groupedCounts) {
    const campaignCounts = counts.get(row.campaignId) || {}
    campaignCounts[row.status] = row._count._all
    counts.set(row.campaignId, campaignCounts)
  }

  return NextResponse.json({
    success: true,
    campaigns: campaigns.map(campaign => ({ ...campaign, counts: counts.get(campaign.id) || {} })),
  })
}

export async function POST(request: NextRequest) {
  if (!await getCurrentAdmin()) return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 })

  try {
    const form = await request.formData()
    const name = String(form.get('name') || '').trim()
    const instructions = String(form.get('instructions') || '').trim()
    const googleSheetUrl = String(form.get('googleSheetUrl') || '').trim()
    const file = form.get('file')
    const delayValue = Number(form.get('interCallDelaySec') || 15)

    if (name.length < 3 || name.length > 120) {
      return NextResponse.json({ success: false, error: 'Campaign name must be 3–120 characters.' }, { status: 400 })
    }
    if (instructions.length < 10 || instructions.length > 2000) {
      return NextResponse.json({ success: false, error: 'Campaign instructions must be 10–2000 characters.' }, { status: 400 })
    }
    const interCallDelaySec = Number.isFinite(delayValue) ? Math.max(5, Math.min(300, Math.round(delayValue))) : 15

    let imported
    let sourceType: string
    let sourceName: string
    if (file instanceof File && file.size > 0) {
      imported = await importCampaignFile(file)
      sourceType = 'file'
      sourceName = file.name.slice(0, 255)
    } else if (googleSheetUrl) {
      imported = await importGoogleSheet(googleSheetUrl)
      sourceType = 'google_sheet'
      sourceName = googleSheetUrl.slice(0, 1000)
    } else {
      return NextResponse.json({ success: false, error: 'Upload an Excel/CSV file or enter a Google Sheets link.' }, { status: 400 })
    }

    const campaign = await prisma.marketingCampaign.create({
      data: {
        name,
        instructions,
        sourceType,
        sourceName,
        interCallDelaySec,
        leads: { create: imported.leads },
      },
      include: { _count: { select: { leads: true } } },
    })

    return NextResponse.json({
      success: true,
      campaign,
      import: {
        acceptedRows: imported.leads.length,
        rejectedRows: imported.rejectedRows,
        duplicateRows: imported.duplicateRows,
        missingRegionRows: imported.missingRegionRows,
      },
    })
  } catch (error) {
    console.error('Campaign import failed:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Campaign could not be imported.',
    }, { status: 400 })
  }
}
