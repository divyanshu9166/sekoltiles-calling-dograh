import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import type { CallStatus } from '@prisma/client'
import { requestedCatalogue } from '@/lib/catalogue/detection.mjs'
import { isTerminalCampaignLifecycle } from '@/lib/campaigns/run-recovery.mjs'
import { transcriptMessages } from '@/lib/transcripts/parse.mjs'

function toStatus(value: unknown): CallStatus {
  const normalized = String(value || '').toLowerCase().replace(/[\s-]+/g, '_')
  if (normalized.includes('busy')) return 'BUSY'
  if (normalized.includes('no_answer') || normalized.includes('unanswered')) return 'NO_ANSWER'
  if (normalized.includes('missed')) return 'MISSED'
  if (normalized.includes('fail') || normalized.includes('error') || normalized.includes('cancel')) return 'FAILED'
  if (normalized.includes('ring') || normalized.includes('progress') || normalized.includes('answer')) return 'IN_PROGRESS'
  return 'COMPLETED'
}

async function loadTranscript(raw: unknown, transcriptUrl: string | null) {
  const direct = transcriptMessages(raw)
  if (direct || !transcriptUrl) return direct

  try {
    const allowedOrigin = new URL(process.env.DOGRAH_API_URL || '').origin
    const url = new URL(transcriptUrl)
    if (url.origin !== allowedOrigin) throw new Error('Unexpected transcript host')
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8_000) })
    if (!response.ok) throw new Error(`Transcript download failed (${response.status})`)
    return transcriptMessages(await response.text())
  } catch (error) {
    console.error('Could not download Dograh transcript:', error)
    return null
  }
}

function positiveInteger(value: unknown): number | null {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

async function finishCampaignLeadFromWebhook(input: {
  campaignId: number | null
  campaignLeadId: number | null
  callLogId: number
  runId: string
  callStatus: CallStatus
  outcome: string
}) {
  const { campaignId, campaignLeadId, callLogId, runId, callStatus, outcome } = input
  if (!campaignLeadId) return

  const now = new Date()
  await prisma.$transaction(async tx => {
    const lead = await tx.campaignLead.findFirst({
      where: {
        id: campaignLeadId,
        ...(campaignId ? { campaignId } : {}),
        status: 'CALLING',
        OR: [
          { callLogId },
          ...(runId ? [{ dograhRunId: runId }] : []),
        ],
      },
      include: { campaign: true },
    })
    if (!lead) return

    const leadStatus = callStatus === 'COMPLETED' ? 'COMPLETED' : 'FAILED'
    const completed = await tx.campaignLead.updateMany({
      where: { id: lead.id, status: 'CALLING' },
      data: {
        status: leadStatus,
        outcome,
        completedAt: now,
        lastError: leadStatus === 'FAILED' ? outcome : null,
      },
    })
    if (!completed.count) return

    await tx.marketingCampaign.update({
      where: { id: lead.campaignId },
      data: { nextCallAt: new Date(now.getTime() + lead.campaign.interCallDelaySec * 1000) },
    })
    console.info(`[campaign-webhook] campaign=${lead.campaignId} lead=${lead.id} finished status=${leadStatus}`)
  })
}

export async function POST(req: NextRequest) {
  if (req.headers.get('x-api-secret') !== process.env.CRM_API_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json() as Record<string, unknown>
    const initialContext = body.initial_context && typeof body.initial_context === 'object'
      ? body.initial_context as Record<string, unknown>
      : {}
    const gatheredContext = body.gathered_context && typeof body.gathered_context === 'object'
      ? body.gathered_context as Record<string, unknown>
      : {}
    const crmCallLogId = Number(body.crm_call_log_id || initialContext.crm_call_log_id)
    const runId = String(body.run_id || body.workflow_run_id || '')

    let callLog = Number.isInteger(crmCallLogId) && crmCallLogId > 0
      ? await prisma.callLog.findUnique({ where: { id: crmCallLogId } })
      : runId
        ? await prisma.callLog.findUnique({ where: { dograhRunId: runId } })
        : null

    if (!callLog && String(initialContext.direction || '').toLowerCase() === 'inbound' && runId) {
      const phone = typeof initialContext.caller_number === 'string' ? initialContext.caller_number : 'Unknown caller'
      const now = new Date()
      callLog = await prisma.callLog.create({
        data: {
          customerName: typeof initialContext.customer_name === 'string' && initialContext.customer_name.trim() ? initialContext.customer_name : 'Unknown Customer',
          phone,
          direction: 'INBOUND',
          status: 'IN_PROGRESS',
          duration: '0:00',
          durationSec: 0,
          agent: 'AI Agent - Anushka',
          date: now,
          time: now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }),
          purpose: 'Inbound enquiry',
          region: typeof initialContext.region === 'string' && initialContext.region.trim() ? initialContext.region.trim().slice(0, 120) : null,
          outcome: 'Inbound Dograh call',
          notes: `Inbound call received from Dograh run ${runId}`,
          dograhRunId: runId,
          callType: 'ai_inbound',
          aiHandled: true,
        },
      })
    }

    if (!callLog) return NextResponse.json({ error: 'Call log not found' }, { status: 404 })
    // Do not restore records that were manually removed from the CRM when a
    // webhook is retried by Dograh after completion.
    if (callLog.deletedAt) return NextResponse.json({ success: true, data: { id: callLog.id, deleted: true } })

    const explicitLifecycle = body.mapped_disposition || body.call_disposition || body.disposition
      || gatheredContext.mapped_call_disposition || gatheredContext.call_disposition
      || gatheredContext.call_status || body.call_status
    const rawOutcome = explicitLifecycle || 'Completed'
    const callStatus = toStatus(body.call_status || gatheredContext.call_status || rawOutcome)
    const durationSec = Math.max(0, Math.round(Number(body.duration || body.duration_seconds || 0)))
    const recordingUrl = typeof body.recording_url === 'string' && body.recording_url ? body.recording_url : null
    const transcriptUrl = typeof body.transcript_url === 'string' && body.transcript_url ? body.transcript_url : null
    const messages = await loadTranscript(body.transcript, transcriptUrl)

    await prisma.callLog.update({
      where: { id: callLog.id },
      data: {
        dograhRunId: runId || callLog.dograhRunId,
        status: callStatus,
        durationSec,
        duration: `${Math.floor(durationSec / 60)}:${String(durationSec % 60).padStart(2, '0')}`,
        outcome: String(rawOutcome),
        region: typeof initialContext.region === 'string' && initialContext.region.trim()
          ? initialContext.region.trim().slice(0, 120)
          : callLog.region,
        recording: !!recordingUrl,
        recordingUrl,
        transcriptUrl,
        notes: `Synced from Dograh run ${runId || callLog.dograhRunId || 'unknown'}`,
      },
    })

    // Campaign calls normally advance from the worker's run poll. This handles
    // real hangup/transfer webhooks immediately, so a missed or delayed run
    // completion event cannot keep the rest of the queue waiting.
    if (isTerminalCampaignLifecycle(explicitLifecycle)) {
      await finishCampaignLeadFromWebhook({
        campaignId: positiveInteger(initialContext.campaign_id),
        campaignLeadId: positiveInteger(initialContext.campaign_lead_id),
        callLogId: callLog.id,
        runId,
        callStatus,
        outcome: String(rawOutcome),
      })
    }

    if (messages && !callLog.transcriptDeletedAt) {
      await prisma.callTranscript.upsert({
        where: { callLogId: callLog.id },
        update: {
          summary: String(body.summary || rawOutcome),
          sentiment: typeof body.sentiment === 'string' ? body.sentiment : 'Neutral',
          messages,
        },
        create: {
          callLogId: callLog.id,
          summary: String(body.summary || rawOutcome),
          sentiment: typeof body.sentiment === 'string' ? body.sentiment : 'Neutral',
          messages,
        },
      })

      // Catalogue delivery remains manual. We only save an explicit customer request
      // from the completed transcript, without changing the live agent conversation.
      if (requestedCatalogue(messages)) {
        await prisma.catalogueRequest.upsert({
          where: { callLogId: callLog.id },
          update: {
            customer: callLog.customerName,
            phone: callLog.phone,
            region: callLog.region,
          },
          create: {
            callLogId: callLog.id,
            customer: callLog.customerName,
            phone: callLog.phone,
            region: callLog.region,
          },
        })
      }
    }

    return NextResponse.json({ success: true, data: { id: callLog.id } })
  } catch (error) {
    console.error('Failed to process Dograh webhook:', error)
    return NextResponse.json({ error: 'Failed to process Dograh webhook' }, { status: 500 })
  }
}
