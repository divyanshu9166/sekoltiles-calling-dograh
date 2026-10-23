/**
 * lib/queues/ai-agent-worker.ts
 *
 * BullMQ worker bootstrap for the wa-ai-agent queue.
 * Imported once in instrumentation.ts alongside the automation worker.
 */

import { createAiAgentWorker, type AiAgentJobData } from './jobs'
import { processAiAgentJob } from '@/lib/ai-agent/agent-worker'
import type { Job } from 'bullmq'

let workerStarted = false

export function startAiAgentWorker() {
  if (workerStarted) return
  workerStarted = true

  const worker = createAiAgentWorker(async (job: Job<AiAgentJobData>) => {
    console.log(
      `[ai-agent-worker] processing job ${job.id} — conversation: ${job.data.conversationId}`,
    )
    await processAiAgentJob(job.data)
  })

  worker.on('completed', (job) => {
    console.log(`[ai-agent-worker] job ${job.id} completed`)
  })

  worker.on('failed', (job, err) => {
    console.error(
      `[ai-agent-worker] job ${job?.id} failed (attempt ${job?.attemptsMade}):`,
      err.message,
    )
  })

  console.log('[ai-agent-worker] started')
}
