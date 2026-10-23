/**
 * instrumentation.ts
 *
 * Next.js instrumentation hook — runs once when the server starts.
 *
 * Boots the WhatsApp Marketing BullMQ workers (automations and the AI agent)
 * so they are registered before the first webhook arrives. Both need Redis
 * (REDIS_URL); see lib/queues/jobs.ts.
 */

export async function register() {
  // Only start the workers in the Node.js runtime, not in the edge runtime
  // (which doesn't support ioredis / worker_threads).
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startAutomationWorker } = await import('./lib/queues/automation-worker')
    startAutomationWorker()

    const { startAiAgentWorker } = await import('./lib/queues/ai-agent-worker')
    startAiAgentWorker()
  }
}
