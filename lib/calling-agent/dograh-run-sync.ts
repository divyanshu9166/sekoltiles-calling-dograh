import 'server-only'

import type { CallStatus, Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getDograhRun, listDograhRuns, type DograhRealtimeEvent, type DograhWorkflowRun } from '@/lib/dograh'

type TranscriptMessage = { from: 'agent' | 'customer'; text: string; time: string }

function runStatus(run: DograhWorkflowRun): CallStatus {
  if (!run.is_completed) return 'IN_PROGRESS'
  const context = run.gathered_context || {}
  const raw = String(context.call_status || context.mapped_call_disposition || context.call_disposition || '').toLowerCase()
  if (raw.includes('busy')) return 'BUSY'
  if (raw.includes('no_answer') || raw.includes('unanswered')) return 'NO_ANSWER'
  if (raw.includes('missed')) return 'MISSED'
  if (raw.includes('fail') || raw.includes('error') || raw.includes('cancel')) return 'FAILED'
  return 'COMPLETED'
}

function outcome(run: DograhWorkflowRun) {
  const context = run.gathered_context || {}
  return String(context.mapped_call_disposition || context.call_disposition || context.call_status || (run.is_completed ? 'Completed' : 'In progress'))
}

function eventTimestamp(event: DograhRealtimeEvent) {
  const raw = event.payload?.timestamp || event.timestamp
  const parsed = raw ? new Date(raw).getTime() : Number.NaN
  return Number.isFinite(parsed) ? parsed : null
}

export function transcriptFromDograhEvents(events: DograhRealtimeEvent[] = []): TranscriptMessage[] {
  const selected = events.filter(event => {
    if (event.type === 'rtf-bot-text') return !!event.payload?.text?.trim()
    return event.type === 'rtf-user-transcription' && event.payload?.final !== false && !!event.payload?.text?.trim()
  })
  const startedAt = selected.map(eventTimestamp).find((value): value is number => value !== null) ?? 0

  return selected.map((event, index) => {
    const timestamp = eventTimestamp(event)
    const elapsed = timestamp === null || !startedAt ? index * 4 : Math.max(0, Math.round((timestamp - startedAt) / 1000))
    return {
      from: event.type === 'rtf-user-transcription' ? 'customer' : 'agent',
      text: event.payload?.text?.trim() || '',
      time: `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`,
    }
  })
}

function initialText(context: Record<string, unknown>, key: string) {
  const value = context[key]
  return typeof value === 'string' ? value.trim() : ''
}

async function persistRun(run: DograhWorkflowRun) {
  const context = run.initial_context || {}
  const runId = String(run.id)
  const explicitId = Number(context.crm_call_log_id)
  let callLog = Number.isInteger(explicitId) && explicitId > 0
    ? await prisma.callLog.findUnique({ where: { id: explicitId } })
    : await prisma.callLog.findUnique({ where: { dograhRunId: runId } })

  if (!callLog) {
    const inbound = (run.call_type || initialText(context, 'direction')).toLowerCase() === 'inbound'
    if (!inbound) return
    const phone = initialText(context, 'caller_number') || 'Unknown caller'
    const now = run.created_at && !Number.isNaN(new Date(run.created_at).getTime()) ? new Date(run.created_at) : new Date()
    callLog = await prisma.callLog.create({
      data: {
        customerName: initialText(context, 'customer_name') || 'Unknown Customer',
        phone,
        direction: 'INBOUND',
        status: runStatus(run),
        duration: '0:00',
        durationSec: 0,
        agent: 'AI Agent - Anushka',
        date: now,
        time: now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }),
        purpose: initialText(context, 'reason') || 'Inbound enquiry',
        region: initialText(context, 'region') || null,
        outcome: outcome(run),
        notes: `Inbound call synced from Dograh run ${runId}`,
        recording: false,
        dograhRunId: runId,
        callType: 'ai_inbound',
        aiHandled: true,
      },
    })
  }

  const durationSec = Math.max(0, Math.round(Number(run.cost_info?.call_duration_seconds || 0)))
  const messages = transcriptFromDograhEvents(run.logs?.realtime_feedback_events)
  await prisma.callLog.update({
    where: { id: callLog.id },
    data: {
      dograhRunId: runId,
      status: runStatus(run),
      durationSec,
      duration: `${Math.floor(durationSec / 60)}:${String(durationSec % 60).padStart(2, '0')}`,
      outcome: outcome(run),
      recording: !!run.recording_public_url,
      recordingUrl: run.recording_public_url || callLog.recordingUrl,
      transcriptUrl: run.transcript_public_url || callLog.transcriptUrl,
      notes: `Synced from Dograh run ${runId}`,
    },
  })

  if (messages.length) {
    const data = {
      summary: outcome(run).replace(/_/g, ' '),
      sentiment: 'Neutral',
      messages: messages as unknown as Prisma.InputJsonValue,
    }
    await prisma.callTranscript.upsert({
      where: { callLogId: callLog.id },
      update: data,
      create: { callLogId: callLog.id, ...data },
    })
  }
}

let lastSyncAt = 0
let activeSync: Promise<void> | null = null

/** Reconciles Dograh runs so missed webhooks cannot hide transcripts or final status. */
export async function syncRecentDograhRuns(force = false) {
  if (!force && Date.now() - lastSyncAt < 10_000) return
  if (activeSync) return activeSync

  activeSync = (async () => {
    const { runs } = await listDograhRuns(25)
    const runIds = runs.map(run => String(run.id))
    const existing = await prisma.callLog.findMany({
      where: { dograhRunId: { in: runIds } },
      include: { transcript: { select: { id: true } } },
    })
    const byRunId = new Map(existing.map(call => [call.dograhRunId, call]))
    const pending = runs.filter(summary => {
      const context = summary.initial_context || {}
      const isSekolRun = context.source === 'sekol-calling-crm' || summary.call_type === 'inbound'
      if (!isSekolRun) return false
      const call = byRunId.get(String(summary.id))
      return !call || !call.transcript || !call.recordingUrl || !['COMPLETED', 'FAILED', 'MISSED', 'NO_ANSWER', 'BUSY'].includes(call.status)
    })
    for (let index = 0; index < pending.length; index += 5) {
      await Promise.all(pending.slice(index, index + 5).map(async summary => {
        const detail = await getDograhRun(summary.id)
        await persistRun(detail)
      }))
    }
    lastSyncAt = Date.now()
  })().finally(() => { activeSync = null })

  return activeSync
}
