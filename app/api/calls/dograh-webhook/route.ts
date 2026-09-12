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
  if (Array.isArray(value)) {
    const normalized = value.map((item, index) => {
      if (!item || typeof item !== 'object') return null
      const message = item as Record<string, unknown>
      const role = String(message.from || message.role || message.speaker || '').toLowerCase()
      const text = String(message.text || message.content || '').trim()
      if (!text) return null
      return {
        from: /user|customer|caller/.test(role) ? 'customer' : 'agent',
        text,
        time: typeof message.time === 'string' ? message.time : `0:${String(index * 4).padStart(2, '0')}`,
      }
    }).filter(Boolean)
    return normalized.length ? normalized as Prisma.InputJsonValue : null
  }
  if (typeof value !== 'string' || !value.trim()) return null

  const lines = value.split('\n').map(line => line.trim()).filter(Boolean)
  const firstTimestamp = lines.map(line => line.match(/^\[([^\]]+)\]/)?.[1])
    .map(value => value ? new Date(value).getTime() : Number.NaN)
    .find(value => Number.isFinite(value))
  return lines.map((line, index) => {
    const match = line.match(/^(?:\[([^\]]+)\]\s*)?(assistant|agent|bot|customer|user|caller):\s*(.*)$/i)
    const timestamp = match?.[1] ? new Date(match[1]).getTime() : Number.NaN
    const elapsed = Number.isFinite(timestamp) && firstTimestamp ? Math.max(0, Math.round((timestamp - firstTimestamp) / 1000)) : index * 4
    const role = match?.[2] || 'assistant'
    return {
      from: /customer|user|caller/i.test(role) ? 'customer' : 'agent',
      text: (match?.[3] || line).trim(),
      time: `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`,
    }
  }) as Prisma.InputJsonValue
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

    const rawOutcome = body.mapped_disposition || body.call_disposition || body.disposition
      || gatheredContext.mapped_call_disposition || gatheredContext.call_disposition
      || gatheredContext.call_status || body.call_status || 'Completed'
    const durationSec = Math.max(0, Math.round(Number(body.duration || body.duration_seconds || 0)))
    const recordingUrl = typeof body.recording_url === 'string' && body.recording_url ? body.recording_url : null
    const transcriptUrl = typeof body.transcript_url === 'string' && body.transcript_url ? body.transcript_url : null
    const messages = await loadTranscript(body.transcript, transcriptUrl)

    await prisma.callLog.update({
      where: { id: callLog.id },
      data: {
        dograhRunId: runId || callLog.dograhRunId,
        status: toStatus(body.call_status || gatheredContext.call_status || rawOutcome),
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
