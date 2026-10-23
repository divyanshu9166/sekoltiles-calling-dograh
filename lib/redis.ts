/**
 * lib/redis.ts
 *
 * Singleton ioredis client shared across the Next.js process.
 *
 * Two clients are exported:
 *   - `redis`        — the primary client, used for publishEvent and BullMQ.
 *   - `publishEvent` — thin helper to publish a typed ChatEvent to a channel.
 *
 * Why a singleton? Next.js hot-reloads in dev spawn a new module scope on
 * every save. Without a global guard the connection count explodes. The
 * `globalThis` pattern is the idiomatic Next.js fix.
 */

import Redis from 'ioredis'

export interface ChatEvent {
  /** Discriminator — drives the switch in use-realtime.ts */
  type: 'new_message' | 'message_status' | 'conversation_update' | 'new_conversation'
  /** Routing: ws-server emits only to `user:<userId>` rooms */
  userId: string
  conversationId: string
  payload: Record<string, unknown>
}

// ── Singleton ──────────────────────────────────────────────────────────────
declare global {
  // eslint-disable-next-line no-var
  var _redisClient: Redis | undefined
}

function createRedisClient(): Redis {
  const url = process.env.REDIS_URL
  if (!url) {
    // Graceful degradation: if Redis is not configured (e.g. local dev
    // without docker), log a warning and return a no-op-safe client that
    // will just fail silently on publish rather than crashing the process.
    console.warn('[redis] REDIS_URL is not set — real-time events disabled')
  }

  const client = new Redis(url ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null, // Required for BullMQ workers
    enableReadyCheck: false,
    lazyConnect: true,
    // Reconnect automatically, backing off up to 30 s.
    retryStrategy: (times) => Math.min(times * 200, 30_000),
  })

  client.on('error', (err: any) => {
    // Suppress ECONNREFUSED logs during build to keep output clean
    if (err?.code === 'ECONNREFUSED') return
    // Log but never throw — a Redis hiccup must not crash the Next.js process.
    console.error('[redis] client error:', err.message)
  })

  return client
}

export const redis: Redis =
  globalThis._redisClient ?? (globalThis._redisClient = createRedisClient())

// ── Publisher ──────────────────────────────────────────────────────────────

/**
 * Publishes a typed event to a Redis Pub/Sub channel.
 *
 * Used for real-time UI events (new message, status dot).
 * Non-critical: a failed publish is logged but never throws.
 */
export async function publishEvent(
  channel: string,
  event: ChatEvent,
): Promise<void> {
  try {
    await redis.publish(channel, JSON.stringify(event))
  } catch (err) {
    // Pub/Sub is fire-and-forget for UI events — log, don't crash.
    console.error('[redis] publishEvent failed:', err instanceof Error ? err.message : err)
  }
}
