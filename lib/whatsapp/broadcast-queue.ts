import { getBroadcastSendQueue } from '@/lib/queues/jobs'

// The queue's Redis client retries forever, so a down Redis would hang the
// request instead of failing; give up after this long.
const QUEUE_TIMEOUT_MS = 10_000

export function broadcastJobId(broadcastId: string) {
  return `broadcast-${broadcastId}`
}

function withTimeout<T>(promise: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out: is Redis running?`)), QUEUE_TIMEOUT_MS)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/**
 * Queues a broadcast for the worker, delayed until `runAt` when given.
 * A no-op if the broadcast already has a job waiting.
 */
export async function enqueueBroadcastSend(broadcastId: string, runAt?: Date | null) {
  const delay = runAt ? Math.max(0, runAt.getTime() - Date.now()) : 0
  await withTimeout(
    getBroadcastSendQueue().add('send', { broadcastId }, { jobId: broadcastJobId(broadcastId), delay }),
    'Queueing the broadcast',
  )
}

/** Drops a broadcast's waiting job. Returns false if it is running right now. */
export async function removeBroadcastSendJob(broadcastId: string): Promise<boolean> {
  const queue = getBroadcastSendQueue()
  const job = await withTimeout(queue.getJob(broadcastJobId(broadcastId)), 'Finding the broadcast job')
  if (!job) return true
  if (await job.isActive()) return false
  await withTimeout(job.remove(), 'Removing the broadcast job')
  return true
}
