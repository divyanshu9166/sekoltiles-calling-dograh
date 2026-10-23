/**
 * lib/whatsapp/api-logger.ts
 *
 * Lightweight Redis-backed log store for Meta API calls and inbound
 * webhook events. Entries are stored as a capped list (latest 200) per
 * user so you can inspect exactly what Meta sent/received without
 * needing Vercel logs or a third-party APM tool.
 *
 * Key:  wa:api:logs:{userId}
 * TTL:  48 hours (auto-expires so Redis memory never grows unbounded)
 */

import { redis } from '@/lib/redis'

export type LogType =
  | 'broadcast_send'   // outbound: we called Meta to send a template
  | 'webhook_status'   // inbound: Meta sent us a status update (sent/delivered/read/failed)
  | 'webhook_message'  // inbound: Meta sent us a customer reply message

export type LogStatus = 'success' | 'error' | 'skipped'

export interface ApiLogEntry {
  id: string           // nanoid — used as React key
  ts: string           // ISO timestamp
  type: LogType
  status: LogStatus

  // Context fields — populated depending on type
  phone?: string
  messageId?: string   // Meta message ID (wamid.xxx)
  templateName?: string
  eventStatus?: string // 'sent' | 'delivered' | 'read' | 'failed' (for webhook_status)
  broadcastId?: string

  // Full payloads — for deep inspection
  request?: Record<string, unknown>   // what we sent to Meta
  response?: Record<string, unknown>  // what Meta returned (or the error)
  webhookPayload?: Record<string, unknown> // raw Meta webhook entry
  errorMessage?: string
}

const LOG_KEY = (userId: string) => `wa:api:logs:${userId}`
const MAX_ENTRIES = 200
const TTL_SECONDS = 48 * 60 * 60 // 48 h

/** Append a log entry for a user. Fire-and-forget — never throws. */
export async function appendLog(
  userId: string,
  entry: Omit<ApiLogEntry, 'id' | 'ts'>,
): Promise<void> {
  try {
    const full: ApiLogEntry = {
      id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
      ts: new Date().toISOString(),
      ...entry,
    }
    const key = LOG_KEY(userId)
    // LPUSH prepends (newest first), LTRIM keeps only the last MAX_ENTRIES
    await redis.lpush(key, JSON.stringify(full))
    await redis.ltrim(key, 0, MAX_ENTRIES - 1)
    await redis.expire(key, TTL_SECONDS)
  } catch {
    // Logging must never break the main flow
  }
}

/** Fetch the most recent `limit` log entries for a user. */
export async function fetchLogs(
  userId: string,
  limit = 100,
): Promise<ApiLogEntry[]> {
  try {
    const raw = await redis.lrange(LOG_KEY(userId), 0, limit - 1)
    return raw.map((r) => JSON.parse(r) as ApiLogEntry)
  } catch {
    return []
  }
}

/** Delete all logs for a user (used by the "Clear" button in the UI). */
export async function clearLogs(userId: string): Promise<void> {
  try {
    await redis.del(LOG_KEY(userId))
  } catch {
    // ignore
  }
}