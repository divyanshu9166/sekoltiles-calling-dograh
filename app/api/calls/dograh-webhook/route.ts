import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import type { CallStatus, Prisma } from '@prisma/client'

function toStatus(value: unknown): CallStatus {
  const normalized = String(value || '').toLowerCase().replace(/[\s-]+/g, '_')
  if (normalized.includes('busy')) return 'BUSY'
  if (normalized.includes('no_answer') || normalized.includes('unanswered')) return 'NO_ANSWER'
  if (normalized.includes('missed')) return 'MISSED'
  if (normalized.includes('fail') || normalized.includes('error') || normalized.includes('cancel')) return 'FAILED'
  if (normalized.includes('ring') || normalized.includes('progress') || normalized.includes('answer')) return 'IN_PROGRESS'
  return 'COMPLETED'
}

function transcriptMessages(value: unknown): Prisma.InputJsonValue | null {
  if (Array.isArray(value)) return value as Prisma.InputJsonValue
  if (typeof value !== 'string' || !value.trim()) return null

  return value.split('\n').filter(Boolean).map((line, index) => {
    const customer = /^(customer|user|caller):\s*/i.test(line)
    return {
      from: customer ? 'customer' : 'agent',
      text: line.replace(/^(agent|assistant|bot|customer|user|caller):\s*/i, '').trim(),
      time: `${Math.floor(index * 7 / 60)}:${String((index * 7) % 60).padStart(2, '0')}`,
    }
  }) as Prisma.InputJsonValue
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

    const callLog = Number.isInteger(crmCallLogId) && crmCallLogId > 0
      ? await prisma.callLog.findUnique({ where: { id: crmCallLogId } })
      : runId
        ? await prisma.callLog.findUnique({ where: { dograhRunId: runId } })
        : null

    if (!callLog) return NextResponse.json({ error: 'Call log not found' }, { status: 404 })

    const rawOutcome = body.mapped_disposition || body.call_disposition || body.disposition
      || gatheredContext.mapped_call_disposition || gatheredContext.call_disposition
      || gatheredContext.call_status || body.call_status || 'Completed'
    const durationSec = Math.max(0, Math.round(Number(body.duration || body.duration_seconds || 0)))
    const recordingUrl = typeof body.recording_url === 'string' && body.recording_url ? body.recording_url : null
    const transcriptUrl = typeof body.transcript_url === 'string' && body.transcript_url ? body.transcript_url : null
    const messages = transcriptMessages(body.transcript)

    await prisma.callLog.update({
      where: { id: callLog.id },
      data: {
        dograhRunId: runId || callLog.dograhRunId,
        status: toStatus(body.call_status || gatheredContext.call_status || rawOutcome),
        durationSec,
        duration: `${Math.floor(durationSec / 60)}:${String(durationSec % 60).padStart(2, '0')}`,
        outcome: String(rawOutcome),
        recording: !!recordingUrl,
        recordingUrl,
        transcriptUrl,
        notes: `Synced from Dograh run ${runId || callLog.dograhRunId || 'unknown'}`,
      },
    })

    if (messages) {
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
    }

    return NextResponse.json({ success: true, data: { id: callLog.id } })
  } catch (error) {
    console.error('Failed to process Dograh webhook:', error)
    return NextResponse.json({ error: 'Failed to process Dograh webhook' }, { status: 500 })
  }
}
