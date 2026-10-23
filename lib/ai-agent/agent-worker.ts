/**
 * lib/ai-agent/agent-worker.ts
 *
 * Core AI agent logic — runs inside a BullMQ worker.
 *
 * 10-step pipeline per inbound message:
 *   1.  Load agent config — abort if disabled
 *   2.  Load last 5 messages for conversation context
 *   3.  Redis cache check — return cached reply if hit
 *   4.  If knowledge exists, embed customer message with multilingual-e5-small
 *   5.  Search pgvector for top-3 relevant knowledge chunks (best effort)
 *   6.  Build prompt (system + knowledge + history + message)
 *   7.  Gemini 3.5 Flash-Lite → draft reply
 *   8.  Confidence/handoff check
 *   9.  Cache reply in Redis (TTL: 2h)
 *  10.  Send reply via WhatsApp Cloud API + save to DB
 */

import { prisma } from '@/lib/db'
import { redis } from '@/lib/redis'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sendTextMessage as sendWhatsAppMessage } from '@/lib/whatsapp/meta-api'
import { decryptSavedSecret } from '@/lib/whatsapp/saved-secrets'
import { embedText } from './embedder'
import { retrieveChunks } from './retriever'
import { generateResponse } from './responder'

// ── Types ──────────────────────────────────────────────────────────────────

export interface AiAgentJobPayload {
  userId: string
  conversationId: string
  contactId: string
  contactPhone: string   // E.164 for WA; PSID/IGSID for social channels
  messageText: string
  incomingMessageId: string  // Meta message ID (for reply context)
  // Social channel routing (optional)
  channel?: 'whatsapp' | 'facebook' | 'instagram'
  socialPageAccessToken?: string // encrypted Page Access Token
  socialRecipientId?: string     // PSID or IGSID
}

// ── Cache helpers ──────────────────────────────────────────────────────────

const CACHE_TTL_SEC = 2 * 60 * 60  // 2 hours
const KNOWLEDGE_LOOKUP_TIMEOUT_MS = 12_000

/**
 * Knowledge retrieval is an optional enhancement. A slow model download or a
 * unavailable vector index must never prevent the customer from receiving a
 * normal Gemini response.
 */
async function withTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`${label} timed out after ${KNOWLEDGE_LOOKUP_TIMEOUT_MS / 1000}s`))
        }, KNOWLEDGE_LOOKUP_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

function cacheKey(userId: string, text: string): string {
  // Normalise: lowercase + strip extra whitespace so "Hi!" and "hi!" share cache
  const normalised = text.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200)
  return `wa:agent:cache:${userId}:${Buffer.from(normalised).toString('base64url').slice(0, 64)}`
}

async function getCachedReply(userId: string, text: string): Promise<string | null> {
  try {
    return await redis.get(cacheKey(userId, text))
  } catch {
    return null
  }
}

async function setCachedReply(userId: string, text: string, reply: string): Promise<void> {
  try {
    await redis.set(cacheKey(userId, text), reply, 'EX', CACHE_TTL_SEC)
  } catch {
    // non-critical
  }
}

// ── Main processor ─────────────────────────────────────────────────────────

export async function processAiAgentJob(payload: AiAgentJobPayload): Promise<void> {
  const {
    userId, conversationId, contactId, contactPhone,
    messageText, incomingMessageId,
    channel = 'whatsapp',
  } = payload

  // ── Step 1: Load agent config ────────────────────────────────────────────
  const config = await prisma.waAgentConfig.findUnique({ where: { user_id: userId } })
  if (!config?.enabled) {
    console.log(`[ai-agent] agent disabled for user ${userId} — skipping`)
    return
  }

  console.log(`[ai-agent] handling ${channel} conversation ${conversationId}`)

  // ── Step 1b: Skip if conversation needs a human agent ───────────────────
  const conv = await prisma.waConversation.findUnique({
    where: { id: conversationId },
    select: { needs_human: true },
  })
  const needsHuman = conv?.needs_human ?? false
  if (needsHuman) {
    console.log(`[ai-agent] conversation ${conversationId} flagged for human — skipping AI reply`)
    return
  }

  // ── Step 2: Load last 5 messages for conversation context ────────────────
  const recentMessages: { sender_type: string; content_text: string | null }[] = await prisma.waMessage.findMany({
    where: { conversation_id: conversationId },
    orderBy: { created_at: 'desc' },
    take: 5,
    select: { sender_type: true, content_text: true },
  })
  const conversationHistory = recentMessages
    .reverse()
    .map((m) => `${m.sender_type === 'customer' ? 'Customer' : 'Agent'}: ${m.content_text ?? ''}`)
    .join('\n')


  // ── Step 3: Redis cache check ────────────────────────────────────────────
  const cached = await getCachedReply(userId, messageText)
  if (cached) {
    console.log(`[ai-agent] cache hit for user ${userId}`)
    await sendAndSaveReply({
      userId, conversationId, contactPhone, replyText: cached,
      incomingMessageId, isFromCache: true,
    })
    return
  }

  // ── Step 4–5: Retrieve knowledge only when the user has an index ─────────
  // A plain conversational agent does not need the local embedding model. This
  // keeps first replies reliable when the optional ONNX model is still loading
  // or the vector index is temporarily unavailable.
  let retrievedChunks = ''
  try {
    const knowledgeCount = await withTimeout(
      prisma.waKnowledgeChunk.count({ where: { user_id: userId } }),
      'Knowledge index check',
    )

    if (knowledgeCount === 0) {
      console.log(`[ai-agent] no indexed knowledge for user ${userId}; skipping embedding`)
    } else {
      console.log(`[ai-agent] retrieving from ${knowledgeCount} indexed knowledge chunks`)
      const queryEmbedding = await withTimeout(
        embedText(messageText),
        'Knowledge embedding',
      )
      const chunks = await withTimeout(
        retrieveChunks(userId, queryEmbedding, 3, config.confidence_threshold),
        'Knowledge retrieval',
      )
      retrievedChunks = chunks.map((chunk) => chunk.content).join('\n\n---\n\n')
    }
  } catch (err) {
    console.warn('[ai-agent] knowledge lookup unavailable; continuing without it:', err)
  }

  // ── Step 6–7: Build prompt + call Gemini ────────────────────────────────
  let agentResponse: Awaited<ReturnType<typeof generateResponse>>
  try {
    console.log(`[ai-agent] requesting Gemini reply for conversation ${conversationId}`)
    agentResponse = await generateResponse({
      agentName: config.agent_name,
      companyName: config.agent_name, // falls back to agent name; editable in system prompt
      companyContext: '',              // embedded in system_prompt if overridden
      retrievedChunks,
      conversationHistory,
      customerMessage: messageText,
      systemPrompt: config.system_prompt,
      maxTokens: config.max_response_tokens,
      apiKey: decryptSavedSecret(config.gemini_api_key, 'Gemini API key'),
    })
    console.log(`[ai-agent] Gemini reply received for conversation ${conversationId}`)
  } catch (err) {
    console.error('[ai-agent] LLM call failed:', err)
    await sendFallback(userId, conversationId, contactPhone, config.fallback_message, incomingMessageId)
    return
  }

  // ── Step 8: Handoff check ─────────────────────────────────────────────────
  if (agentResponse.needsHandoff) {
    console.log(`[ai-agent] handoff requested — flagging for human`)
    // Flag for human review
    await prisma.waConversation.update({
      where: { id: conversationId },
      data: { needs_human: true },
    }).catch((err) => console.warn('[ai-agent] failed to set needs_human flag:', err))
    await sendFallback(userId, conversationId, contactPhone, config.fallback_message, incomingMessageId)
    return
  }

  const replyText = agentResponse.text

  // ── Step 9: Cache reply ───────────────────────────────────────────────────
  await setCachedReply(userId, messageText, replyText)

  // ── Step 10: Optional delay + send + save ────────────────────────────────
  if (config.response_delay_ms > 0) {
    await new Promise((r) => setTimeout(r, config.response_delay_ms))
  }
  await sendAndSaveReply({
    userId, conversationId, contactPhone, replyText,
    incomingMessageId, isFromCache: false,
  })
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function getWaConfig(userId: string) {
  const waConfig = await prisma.waWhatsappConfig.findUnique({ where: { user_id: userId } })
  if (!waConfig) throw new Error(`No WA config for user ${userId}`)
  return {
    phoneNumberId: waConfig.phone_number_id,
    accessToken: decrypt(waConfig.access_token),
  }
}

async function sendAndSaveReply(opts: {
  userId: string
  conversationId: string
  contactPhone: string
  replyText: string
  incomingMessageId: string
  isFromCache: boolean
}) {
  const {
    userId, conversationId, contactPhone, replyText,
    incomingMessageId,
  } = opts

  let metaMessageId: string | undefined

  // ── WhatsApp send ──────────────────────────────────────────────────────
  let waConfig: { phoneNumberId: string; accessToken: string }
  try {
    waConfig = await getWaConfig(userId)
  } catch (err) {
    console.error('[ai-agent] cannot load WA config:', err)
    return
  }
  try {
    const result = await sendWhatsAppMessage({
      phoneNumberId: waConfig.phoneNumberId,
      accessToken: waConfig.accessToken,
      to: contactPhone,
      text: replyText,
      contextMessageId: incomingMessageId,
    })
    metaMessageId = result.messageId
  } catch (err) {
    console.error('[ai-agent] sendTextMessage failed:', err)
    return
  }

  // Persist the AI reply
  try {
    await prisma.waMessage.create({
      data: {
        conversation_id: conversationId,
        sender_type: 'agent',
        content_type: 'text',
        content_text: replyText,
        message_id: metaMessageId,
        status: 'sent',
      },
    })
    await prisma.waConversation.update({
      where: { id: conversationId },
      data: {
        last_message_text: replyText,
        last_message_at: new Date(),
      },
    })
  } catch (err) {
    console.error('[ai-agent] DB save failed:', err)
  }

  console.log(`[ai-agent] replied to conversation ${conversationId}`)
}

async function sendFallback(
  userId: string,
  conversationId: string,
  contactPhone: string,
  fallbackMessage: string,
  incomingMessageId: string,
) {
  await sendAndSaveReply({
    userId, conversationId, contactPhone,
    replyText: fallbackMessage,
    incomingMessageId,
    isFromCache: false,
  })
}

// ── Knowledge indexer (called from the knowledge API route) ───────────────

/**
 * Index a newly uploaded knowledge document:
 *   1. Chunk the raw text
 *   2. Embed each chunk with multilingual-e5-small (local ONNX)
 *   3. Insert chunks + update embeddings via raw SQL (384-dim vectors)
 *   4. Mark the doc as indexed
 */
export async function indexKnowledgeDoc(docId: string): Promise<void> {
  const doc = await prisma.waKnowledgeDoc.findUnique({ where: { id: docId } })
  if (!doc) throw new Error(`Doc ${docId} not found`)

  await prisma.waKnowledgeDoc.update({
    where: { id: docId },
    data: { status: 'pending' },
  })

  try {
    const { chunkText } = await import('./chunker')
    const { embedDocument } = await import('./embedder')

    const chunks = chunkText(doc.raw_text)

    // Delete old chunks if re-indexing
    await prisma.waKnowledgeChunk.deleteMany({ where: { doc_id: docId } })

    for (let i = 0; i < chunks.length; i++) {
      const content = chunks[i]

      // Create the chunk row first (without embedding)
      const chunk = await prisma.waKnowledgeChunk.create({
        data: {
          user_id: doc.user_id,
          doc_id: docId,
          chunk_index: i,
          content,
        },
      })

      // Embed and update via raw SQL (pgvector column not in Prisma schema).
      // MUST use $executeRawUnsafe — parameterized bindings cannot be cast
      // to the vector type by the pg driver; the literal must be inline.
      const embedding = await embedDocument(content)
      const vectorLiteral = `[${embedding.join(',')}]`

      await prisma.$executeRawUnsafe(
        `UPDATE wa_knowledge_chunks SET embedding = $1::vector WHERE id = $2`,
        vectorLiteral,
        chunk.id,
      )
    }

    await prisma.waKnowledgeDoc.update({
      where: { id: docId },
      data: { status: 'indexed', error: null },
    })

    console.log(`[ai-agent] indexed doc ${docId} — ${chunks.length} chunks`)
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    await prisma.waKnowledgeDoc.update({
      where: { id: docId },
      data: { status: 'error', error },
    })
    throw err
  }
}
