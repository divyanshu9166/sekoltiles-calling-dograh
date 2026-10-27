/**
 * lib/queues/broadcast-send-worker.ts
 *
 * BullMQ worker that sends WhatsApp broadcasts, started from
 * instrumentation.ts. The sending logic lives in
 * lib/whatsapp/broadcast-sender.ts.
 */

import type { Job } from 'bullmq'
import {
  createBroadcastSendQueueEvents,
  createBroadcastSendWorker,
  type BroadcastSendJobData,
} from './jobs'
import { prisma } from '@/lib/db'
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import {
  BroadcastRetryLaterError,
  DEFAULT_RATE_PER_SECOND,
  INTERRUPTED_REASON,
  processBroadcast,
} from '@/lib/whatsapp/broadcast-sender'
import { prismaBroadcastStore } from '@/lib/whatsapp/broadcast-store'
import { broadcastJobId, enqueueBroadcastSend } from '@/lib/whatsapp/broadcast-queue'

let workerStarted = false

function ratePerSecond() {
  const value = Number(process.env.WHATSAPP_BROADCAST_RATE_PER_SECOND)
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_RATE_PER_SECOND
}

export async function runBroadcastSendJob(job: Job<BroadcastSendJobData>) {
  const attempts = job.opts.attempts ?? 1
  const result = await processBroadcast(
    job.data.broadcastId,
    {
      store: prismaBroadcastStore,
      send: sendTemplateMessage,
      ratePerSecond: ratePerSecond(),
      log: (message) => console.log(`[broadcast-worker] ${job.data.broadcastId}: ${message}`),
    },
    { finalAttempt: job.attemptsMade + 1 >= attempts },
  )
  console.log(
    `[broadcast-worker] ${job.data.broadcastId} ${result.outcome}: sent ${result.sent}, failed ${result.failed}, skipped ${result.skipped}`,
  )
  return result
}

/** After the last retry, stop the broadcast instead of leaving it on "sending". */
async function giveUp(broadcastId: string, message: string) {
  const reason = `Sending stopped after repeated errors: ${message}`
  try {
    await prismaBroadcastStore.failInFlight(broadcastId, INTERRUPTED_REASON)
    await prismaBroadcastStore.closePending(broadcastId, 'failed', reason)
    await prismaBroadcastStore.refreshStats(broadcastId)
    await prismaBroadcastStore.finish(broadcastId, 'failed', reason)
  } catch (finalErr) {
    console.error(`[broadcast-worker] could not mark ${broadcastId} failed:`, finalErr)
  }
}

/**
 * Re-queues broadcasts that are scheduled or mid-send but have no job, e.g.
 * after Redis lost its data. Queueing is a no-op when the job still exists.
 */
export async function requeueOrphanedBroadcasts() {
  const broadcasts = await prisma.waBroadcast.findMany({
    where: { status: { in: ['scheduled', 'sending'] } },
    select: { id: true, status: true, scheduled_at: true },
  })
  for (const b of broadcasts) {
    await enqueueBroadcastSend(b.id, b.status === 'scheduled' ? b.scheduled_at : null)
  }
  if (broadcasts.length) console.log(`[broadcast-worker] checked ${broadcasts.length} queued broadcast(s)`)
}

export function startBroadcastSendWorker() {
  if (workerStarted) return
  workerStarted = true

  const worker = createBroadcastSendWorker(runBroadcastSendJob)

  worker.on('failed', (job, err) => {
    if (!job) return
    const attempts = job.opts.attempts ?? 1
    if (err instanceof BroadcastRetryLaterError || err.name === 'BroadcastRetryLaterError') {
      console.log(`[broadcast-worker] ${job.data.broadcastId}: ${err.message} (attempt ${job.attemptsMade}/${attempts})`)
    } else {
      console.error(`[broadcast-worker] job ${job.id} failed (attempt ${job.attemptsMade}/${attempts}):`, err.message)
    }
    if (job.attemptsMade >= attempts) void giveUp(job.data.broadcastId, err.message)
  })

  worker.on('error', (err) => {
    console.error('[broadcast-worker] error:', err.message)
  })

  // A job that stalls more than maxStalledCount times (its worker kept
  // dying or blocking) is failed inside Redis, and no Worker 'failed' event
  // fires for it. Without this the broadcast would sit on "sending".
  const queueEvents = createBroadcastSendQueueEvents()
  const jobIdPrefix = broadcastJobId('')
  queueEvents.on('failed', ({ jobId, failedReason }) => {
    if (!/stalled more than allowable limit/i.test(failedReason ?? '') || !jobId.startsWith(jobIdPrefix)) return
    const broadcastId = jobId.slice(jobIdPrefix.length)
    console.error(`[broadcast-worker] ${broadcastId}: job stalled too many times; stopping the broadcast`)
    void giveUp(broadcastId, 'the sending job kept stalling')
  })
  queueEvents.on('error', (err) => {
    console.error('[broadcast-worker] queue events error:', err.message)
  })

  void requeueOrphanedBroadcasts().catch((err) => {
    console.error('[broadcast-worker] could not re-queue broadcasts:', err instanceof Error ? err.message : err)
  })

  console.log('[broadcast-worker] started')
}
