/**
 * ws-server/index.js
 *
 * WebSocket gateway.
 *
 * Responsibilities:
 *   1. Accept socket.io connections from authenticated browser clients.
 *   2. Verify the JWT/session token on handshake — reject unauthenticated sockets.
 *   3. Join each authenticated socket to a private `user:<userId>` room.
 *   4. Subscribe to Redis Pub/Sub `chat_events` channel.
 *   5. On each Redis message, parse the ChatEvent and emit it only to the
 *      matching `user:<userId>` room — zero cross-tenant leakage.
 *   6. Expose a /health HTTP endpoint for the docker-compose healthcheck.
 *
 * Security guarantees:
 *   - Every connection is refused unless it carries a valid SESSION_SECRET
 *     signed token. The `auth.token` field is the same JWT the Next.js
 *     app issues on login.
 *   - Events are emitted to `user:<userId>` rooms only, so a malicious
 *     client cannot subscribe to another user's stream even if they somehow
 *     bypass the auth check (they would be in the wrong room).
 */

import { createServer } from 'http'
import { Server } from 'socket.io'
import Redis from 'ioredis'
import jwt from 'jsonwebtoken'

// ── Config ─────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? '3001', 10)
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379'
const SESSION_SECRET = process.env.SESSION_SECRET
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? '*'
const REDIS_CHANNEL = 'chat_events'

if (!SESSION_SECRET) {
  console.error('[ws-server] FATAL: SESSION_SECRET is not set. Exiting.')
  process.exit(1)
}

// ── HTTP + socket.io server ────────────────────────────────────────────────

const httpServer = createServer((req, res) => {
  // Lightweight health endpoint for docker-compose healthcheck
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }))
    return
  }
  res.writeHead(404)
  res.end()
})

const io = new Server(httpServer, {
  cors: {
    origin: CORS_ORIGIN,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  // Allow long-polling as a fallback so clients behind restrictive proxies
  // still work. socket.io upgrades to WebSocket automatically when possible.
  transports: ['polling', 'websocket'],
  pingTimeout: 60_000,
  pingInterval: 25_000,
})

// ── Auth middleware ────────────────────────────────────────────────────────

io.use((socket, next) => {
  const token = socket.handshake.auth?.token

  if (!token || typeof token !== 'string') {
    return next(new Error('Authentication required'))
  }

  try {
    const decoded = jwt.verify(token, SESSION_SECRET)

    if (typeof decoded !== 'object' || !decoded || !decoded.id) {
      return next(new Error('Invalid token payload'))
    }

    // Attach verified identity to the socket for downstream use
    socket.data.userId = String(decoded.id)
    next()
  } catch (err) {
    console.warn('[ws-server] auth failed:', err.message)
    return next(new Error('Unauthorized'))
  }
})

// ── Connection handler ────────────────────────────────────────────────────

io.on('connection', (socket) => {
  const userId = socket.data.userId

  // Join the user-private room — all events for this user are emitted here
  socket.join(`user:${userId}`)

  console.log(`[ws] connected  user:${userId}  socket:${socket.id}`)

  socket.on('disconnect', (reason) => {
    console.log(`[ws] disconnected user:${userId}  reason:${reason}`)
  })

  // Client can explicitly subscribe to a specific conversation for
  // fine-grained typing indicators in the future. Not required for
  // the basic new_message flow — user rooms cover that.
  socket.on('join_conversation', (conversationId) => {
    if (typeof conversationId === 'string' && conversationId) {
      socket.join(`conv:${conversationId}:user:${userId}`)
    }
  })

  socket.on('leave_conversation', (conversationId) => {
    if (typeof conversationId === 'string' && conversationId) {
      socket.leave(`conv:${conversationId}:user:${userId}`)
    }
  })
})

// ── Redis subscriber ──────────────────────────────────────────────────────

// A dedicated subscriber connection is required by Redis protocol — you
// cannot use a subscriber connection for any other commands.
const subscriber = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  retryStrategy: (times) => Math.min(times * 300, 30_000),
})

subscriber.on('connect', () => {
  console.log(`[redis] subscriber connected, listening on "${REDIS_CHANNEL}"`)
})

subscriber.on('error', (err) => {
  console.error('[redis] subscriber error:', err.message)
})

subscriber.subscribe(REDIS_CHANNEL, (err) => {
  if (err) {
    console.error('[redis] subscribe failed:', err.message)
    process.exit(1)
  }
})

subscriber.on('message', (channel, raw) => {
  if (channel !== REDIS_CHANNEL) return

  let event
  try {
    event = JSON.parse(raw)
  } catch {
    console.warn('[ws-server] received malformed JSON from Redis, skipping')
    return
  }

  const { type, userId, conversationId, payload } = event

  if (!userId) {
    console.warn('[ws-server] event missing userId, skipping:', type)
    return
  }

  // Emit only to the private user room — no cross-tenant leakage
  io.to(`user:${userId}`).emit(type, { conversationId, ...payload })

  console.log(`[ws] emitting "${type}" → user:${userId}  conv:${conversationId}`)
})

// ── Start ─────────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`[ws-server] listening on port ${PORT}`)
})

// ── Graceful shutdown ─────────────────────────────────────────────────────

async function shutdown(signal) {
  console.log(`[ws-server] received ${signal}, shutting down…`)
  await subscriber.quit()
  io.close(() => {
    console.log('[ws-server] all sockets closed')
    process.exit(0)
  })
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
