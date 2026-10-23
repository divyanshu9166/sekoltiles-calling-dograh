/**
 * lib/queues/automation-worker.ts
 *
 * BullMQ worker for the automation-queue.
 *
 * This file must be imported once in the Next.js server startup path so the
 * worker process registers itself. In Next.js 15 the conventional place is
 * `instrumentation.ts` (runs once per server boot, not per request).
 *
 * The worker calls `runAutomationsForTrigger` — the existing automation
 * engine — so all automation logic stays in one place; the only change is
 * that the trigger now arrives via a durable BullMQ job instead of a
 * fire-and-forget function call.
 */

import { createAutomationWorker, type AutomationJobData } from './jobs'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import type { Job } from 'bullmq'

let workerStarted = false

export function startAutomationWorker() {
  if (workerStarted) return
  workerStarted = true

  const worker = createAutomationWorker(async (job: Job<AutomationJobData>) => {
    const { userId, triggerType, contactId, context } = job.data

    console.log(
      `[automation-worker] processing job ${job.id} — trigger: ${triggerType}`,
    )

    await runAutomationsForTrigger({
      userId,
      triggerType,
      contactId,
      context,
    })
  })

  worker.on('completed', (job) => {
    console.log(`[automation-worker] job ${job.id} completed`)
  })

  worker.on('failed', (job, err) => {
    console.error(
      `[automation-worker] job ${job?.id} failed (attempt ${job?.attemptsMade}):`,
      err.message,
    )
  })

  console.log('[automation-worker] started')
}
