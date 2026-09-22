'use server'

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { createCallLogSchema } from '@/lib/validations/call'
import type { CallDirection, CallStatus } from '@prisma/client'
import { outboundAICallSchema } from '@/lib/validations/ai-call'
import { callingAgentStatus } from '@/lib/calling-agent-status'
import { getCurrentAdmin } from '@/lib/auth'
import { syncRecentDograhRuns } from '@/lib/calling-agent/dograh-run-sync'

export async function getCallLogs() {
  if (!await getCurrentAdmin()) return { success: false, error: 'Unauthorized.', data: [] }
  try {
    await syncRecentDograhRuns()
  } catch (error) {
    console.error('Dograh call reconciliation failed:', error)
  }
  const calls = await prisma.callLog.findMany({
    where: { deletedAt: null },
    include: { contact: true, transcript: true },
    orderBy: { date: 'desc' },
  })

  return {
    success: true,
    data: calls.map(c => ({
      id: c.id,
      customer: c.customerName,
      phone: c.phone,
      direction: c.direction === 'INBOUND' ? 'Inbound' : 'Outbound',
      status: c.status.charAt(0) + c.status.slice(1).toLowerCase().replace('_', ' '),
      duration: c.duration,
      durationSec: c.durationSec,
      agent: c.agent,
      date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(c.date),
      time: c.date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }),
      purpose: c.purpose,
      region: c.region,
      outcome: c.outcome,
      notes: c.notes,
      recording: c.recording,
      recordingUrl: c.recordingUrl,
      transcriptUrl: c.transcriptUrl,
      aiHandled: c.aiHandled,
      callType: c.callType,
      transcript: c.transcript && !c.transcriptDeletedAt ? {
        summary: c.transcript.summary,
        sentiment: c.transcript.sentiment,
        messages: c.transcript.messages,
      } : null,
    })),
  }
}

export async function createCallLog(data: unknown) {
  if (!await getCurrentAdmin()) return { success: false, error: 'Unauthorized.' }
  const parsed = createCallLogSchema.safeParse(data)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const { customerName, phone, direction, status, duration, durationSec, agent, purpose, outcome, notes, recording } = parsed.data

  // Try to link to existing contact
  const contact = await prisma.contact.findFirst({ where: { phone } })

  const now = new Date()
  const callLog = await prisma.callLog.create({
    data: {
      contactId: contact?.id,
      customerName,
      phone,
      direction: direction as CallDirection,
      status: status as CallStatus,
      duration,
      durationSec,
      agent,
      date: now,
      time: now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }),
      purpose,
      outcome,
      notes,
      recording,
    },
  })

  revalidatePath('/calls')
  return { success: true, data: callLog }
}

export async function getCallStats() {
  if (!await getCurrentAdmin()) return { success: false, error: 'Unauthorized.' }
  const [total, completed, missed, totalDuration, aiHandled] = await Promise.all([
    prisma.callLog.count(),
    prisma.callLog.count({ where: { status: 'COMPLETED' } }),
    prisma.callLog.count({ where: { status: 'MISSED' } }),
    prisma.callLog.aggregate({ _sum: { durationSec: true } }),
    prisma.callLog.count({ where: { aiHandled: true } }),
  ])

  return {
    success: true,
    data: {
      total,
      completed,
      missed,
      aiHandled,
      avgDuration: total > 0 ? Math.round((totalDuration._sum.durationSec || 0) / total) : 0,
    },
  }
}

export async function initiateAICall(phoneNumber: string, reason: string, customerName: string = '', region: string = '') {
  if (!await getCurrentAdmin()) return { success: false, error: 'Unauthorized.' }
  const parsed = outboundAICallSchema.safeParse({ phoneNumber, reason, customerName, region })
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  try {
    const DOGRAH_API_URL = process.env.DOGRAH_API_URL
    const DOGRAH_API_KEY = process.env.DOGRAH_API_KEY
    const DOGRAH_WORKFLOW_UUID = process.env.DOGRAH_WORKFLOW_UUID

    if (!DOGRAH_API_URL || !DOGRAH_API_KEY || !DOGRAH_WORKFLOW_UUID) {
      return { success: false, error: 'Dograh not configured. Set DOGRAH_API_URL, DOGRAH_API_KEY, and DOGRAH_WORKFLOW_UUID in .env' }
    }

    const { startOutboundAICall } = await import('@/lib/calling-agent/outbound')
    const { dograhRunId, callLogId } = await startOutboundAICall(parsed.data)

    revalidatePath('/calls')
    return { success: true, data: { dograhRunId, callLogId, message: `Call queued for ${phoneNumber}` } }
  } catch (error: unknown) {
    console.error('Failed to initiate AI call:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Failed to initiate call' }
  }
}

export async function getAIAgentStatus() {
  if (!await getCurrentAdmin()) return { success: false, error: 'Unauthorized.' }
  return { success: true, data: await callingAgentStatus() }
}
