/**
 * lib/queues/jobs.ts
 *
 * BullMQ queue and worker definitions for durable, retryable workflows.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  Queue              │ Job               │ Retries │ Backoff         │
 * ├─────────────────────────────────────────────────────────────────────┤
 * │  automation-queue   │ run automation    │ 3       │ Exponential 5 s │
 * │  broadcast-status   │ sync counts       │ 5       │ Exponential 2 s │
 * │  message-delivery   │ retry failed send │ 3       │ Fixed 10 s      │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * Workers are imported separately so they only run in the right process
 * (Node.js server — not the edge runtime or the browser).
 */

import { Queue, Worker, type Job } from 'bullmq'
import type { RedisOptions } from 'ioredis'

// BullMQ manages its own internal Redis connections using these options.
// We do NOT share the main redis singleton here — BullMQ needs to control
// its own connection lifecycle (blocking commands, health checks, etc.).
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379'

function parseRedisUrl(url: string): RedisOptions {
  try {
    const parsed = new URL(url)
    return {
      host: parsed.hostname || 'localhost',
      port: parsed.port ? parseInt(parsed.port, 10) : 6379,
      password: parsed.password || undefined,
      db: parsed.pathname ? parseInt(parsed.pathname.slice(1), 10) || 0 : 0,
      maxRetriesPerRequest: null, // Required for BullMQ
      enableReadyCheck: false,
      retryStrategy: (times: number) => Math.min(times * 200, 30_000),
    }
  } catch {
    // Fallback to localhost if URL parsing fails
    return {
      host: 'localhost',
      port: 6379,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      retryStrategy: (times: number) => Math.min(times * 200, 30_000),
    }
  }
}

const connection: RedisOptions = parseRedisUrl(REDIS_URL)

// ── Queue names ────────────────────────────────────────────────────────────
export const QUEUE_AUTOMATION = 'automation-queue'
export const QUEUE_BROADCAST_STATUS = 'broadcast-status-queue'
export const QUEUE_MESSAGE_DELIVERY = 'message-delivery-queue'
export const QUEUE_AI_AGENT = 'wa-ai-agent'
export const QUEUE_FOLLOWUP_REMINDERS = 'followup-reminders-queue'

// ── Typed job data shapes ──────────────────────────────────────────────────

export interface AutomationJobData {
  userId: string
  triggerType:
  | 'new_contact_created'
  | 'first_inbound_message'
  | 'new_message_received'
  | 'keyword_match'
  contactId: string
  context: {
    message_text?: string
    conversation_id?: string
  }
}

export interface BroadcastStatusJobData {
  broadcastId: string
  recipientId: string
  status: string
  timestamp: number
}

export interface MessageDeliveryJobData {
  conversationId: string
  userId: string
  messageId: string      // internal DB id
  metaMessageId?: string // Meta's wa_id for status lookups
}

export interface AiAgentJobData {
  userId: string
  conversationId: string
  contactId: string
  contactPhone: string        // E.164 for WhatsApp; PSID/IGSID for social
  messageText: string
  incomingMessageId: string
  // Social channel fields (optional — only present for Facebook/Instagram jobs)
  channel?: 'whatsapp' | 'facebook' | 'instagram'
  socialPageAccessToken?: string  // encrypted Page Access Token for Messenger API
  socialRecipientId?: string      // PSID or IGSID to reply to
}

// ── Queue instances (Lazy Loaded) ──────────────────────────────────────────
let _automationQueue: Queue<AutomationJobData> | undefined
export function getAutomationQueue() {
  if (!_automationQueue) {
    _automationQueue = new Queue<AutomationJobData>(QUEUE_AUTOMATION, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
    })
  }
  return _automationQueue
}

let _broadcastStatusQueue: Queue<BroadcastStatusJobData> | undefined
export function getBroadcastStatusQueue() {
  if (!_broadcastStatusQueue) {
    _broadcastStatusQueue = new Queue<BroadcastStatusJobData>(
      QUEUE_BROADCAST_STATUS,
      {
        connection,
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 2_000 },
          removeOnComplete: { count: 200 },
          removeOnFail: { count: 500 },
        },
      },
    )
  }
  return _broadcastStatusQueue
}

let _messageDeliveryQueue: Queue<MessageDeliveryJobData> | undefined
export function getMessageDeliveryQueue() {
  if (!_messageDeliveryQueue) {
    _messageDeliveryQueue = new Queue<MessageDeliveryJobData>(
      QUEUE_MESSAGE_DELIVERY,
      {
        connection,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'fixed', delay: 10_000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 500 },
        },
      },
    )
  }
  return _messageDeliveryQueue
}

let _aiAgentQueue: Queue<AiAgentJobData> | undefined
export function getAiAgentQueue() {
  if (!_aiAgentQueue) {
    _aiAgentQueue = new Queue<AiAgentJobData>(QUEUE_AI_AGENT, {
      connection,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 500 },
      },
    })
  }
  return _aiAgentQueue
}

// ── Worker factory ─────────────────────────────────────────────────────────
// Workers are created lazily so importing this module in the Next.js
// process (which runs in both server and edge contexts) doesn't accidentally
// spawn worker threads in the wrong environment.

type WorkerHandler<T> = (job: Job<T>) => Promise<void>

export function createAutomationWorker(handler: WorkerHandler<AutomationJobData>): Worker {
  return new Worker<AutomationJobData>(QUEUE_AUTOMATION, handler, {
    connection,
    concurrency: 5,
  })
}

export function createBroadcastStatusWorker(
  handler: WorkerHandler<BroadcastStatusJobData>,
): Worker {
  return new Worker<BroadcastStatusJobData>(QUEUE_BROADCAST_STATUS, handler, {
    connection,
    concurrency: 10,
  })
}

export function createMessageDeliveryWorker(
  handler: WorkerHandler<MessageDeliveryJobData>,
): Worker {
  return new Worker<MessageDeliveryJobData>(QUEUE_MESSAGE_DELIVERY, handler, {
    connection,
    concurrency: 5,
  })
}

export function createAiAgentWorker(
  handler: WorkerHandler<AiAgentJobData>,
): Worker {
  // concurrency = 2 caps concurrent Gemini API calls (prevents rate limits)
  return new Worker<AiAgentJobData>(QUEUE_AI_AGENT, handler, {
    connection,
    concurrency: 2,
  })
}

// ── Follow-up reminders (daily scheduled sweep) ─────────────────────────────
let _followUpReminderQueue: Queue | undefined
export function getFollowUpReminderQueue() {
  if (!_followUpReminderQueue) {
    _followUpReminderQueue = new Queue(QUEUE_FOLLOWUP_REMINDERS, {
      connection,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'fixed', delay: 60_000 },
        removeOnComplete: { count: 30 },
        removeOnFail: { count: 50 },
      },
    })
  }
  return _followUpReminderQueue
}

export function createFollowUpReminderWorker(handler: WorkerHandler<unknown>): Worker {
  return new Worker(QUEUE_FOLLOWUP_REMINDERS, handler, {
    connection,
    concurrency: 1,
  })
}
