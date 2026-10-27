/**
 * Server-side broadcast sending, run by the BullMQ worker in
 * lib/queues/broadcast-send-worker.ts.
 *
 * One job per broadcast works through its `pending` recipients, so a job
 * that is retried or re-queued after a restart picks up where it stopped
 * and never re-sends to a recipient already marked sent or failed.
 *
 * Database access goes through the BroadcastStore interface (Prisma version
 * in broadcast-store.ts) so this file can be unit-tested in memory.
 */

import { MetaApiError, type MetaSendResult, type SendTemplateMessageArgs } from '@/lib/whatsapp/meta-api'
import {
  humanReadableMetaError,
  isRecipientNotAllowedError,
  isRecipientNotRegisteredError,
  isValidE164,
  normalizePhoneForMetaIndia,
  phoneVariants,
} from '@/lib/whatsapp/phone-utils'
import { describeStatusErrors } from '@/lib/whatsapp/delivery-errors'
import { parseHeaderMedia } from '@/lib/whatsapp/template-header'
import { parseVariableMappings, resolveVariables } from '@/lib/whatsapp/broadcast-variables'

// ── Store ──────────────────────────────────────────────────────────────────

export interface BroadcastRecord {
  id: string
  user_id: string
  status: string
  template_name: string
  template_language: string
  template_variables: unknown
  header_media: unknown
}

export interface PendingRecipient {
  id: string
  /** Null when the contact was deleted after the broadcast was created. */
  contact: {
    id: string
    phone: string
    name: string | null
    email: string | null
    company: string | null
    opted_out_at: Date | null
  } | null
  /** custom_field_id → value */
  customValues: Record<string, string>
}

export interface BroadcastCounts {
  sent_count: number
  failed_count: number
}

export interface BroadcastStore {
  getBroadcast(id: string): Promise<BroadcastRecord | null>
  /** scheduled|sending → sending. False if the broadcast is in any other state. */
  claimForSending(id: string): Promise<boolean>
  getStatus(id: string): Promise<string | null>
  getSenderConfig(userId: string): Promise<{ phoneNumberId: string; accessToken: string } | null>
  getTemplateBody(userId: string, name: string, language: string): Promise<string | null>
  listPendingRecipients(broadcastId: string, limit: number, excludeIds: string[]): Promise<PendingRecipient[]>
  markSent(recipientId: string, whatsappMessageId: string): Promise<void>
  markUnsent(recipientId: string, status: 'failed' | 'skipped', error: string): Promise<void>
  failAllPending(broadcastId: string, error: string): Promise<void>
  refreshStats(broadcastId: string): Promise<BroadcastCounts>
  /** Final status; only applies while the broadcast is still `sending`. */
  finish(broadcastId: string, status: 'sent' | 'failed', error: string | null): Promise<void>
  /** Adds the sent template to the contact's inbox conversation. */
  recordMessage(args: {
    userId: string
    contactId: string
    templateName: string
    renderedText: string
    whatsappMessageId: string
  }): Promise<void>
}

// ── Errors ─────────────────────────────────────────────────────────────────

/** Worth retrying later: throughput / per-user pair limits, Meta outages. */
const RETRY_CODES = new Set([130429, 131056, 131000, 1, 2])

/**
 * Wrong for every recipient (token, sender number, template, account), so
 * sending to the rest would only repeat the same failure.
 */
const STOP_CODES = new Set([190, 10, 200, 133010, 132001, 131031, 131042, 368, 132015, 132016])

export type SendErrorKind = 'retry' | 'stop' | 'recipient'

export function metaErrorCode(err: unknown): number | undefined {
  if (err instanceof MetaApiError && err.code !== undefined) return err.code
  const message = err instanceof Error ? err.message : String(err)
  const match = /\(#(\d+)\)/.exec(message)
  return match ? Number(match[1]) : undefined
}

export function classifySendError(err: unknown): SendErrorKind {
  const code = metaErrorCode(err)
  if (code !== undefined) {
    if (RETRY_CODES.has(code)) return 'retry'
    if (STOP_CODES.has(code)) return 'stop'
    return 'recipient'
  }
  if (err instanceof MetaApiError) return err.httpStatus >= 500 ? 'retry' : 'recipient'
  // No HTTP response at all (DNS, reset, timeout): the request never landed.
  return 'retry'
}

export function friendlySendError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const human = humanReadableMetaError(raw)
  if (human !== raw) return human
  const code = metaErrorCode(err)
  if (code !== undefined) return describeStatusErrors([{ code, message: raw }])
  return raw || 'Unknown error'
}

export const OPTED_OUT_REASON = 'Skipped: this customer opted out of marketing messages.'
export const NO_SENDER_REASON =
  'WhatsApp is not connected. Set it up in WhatsApp Marketing → Settings, then send the broadcast again.'

/** Thrown so BullMQ retries the job later for recipients hit by rate limits. */
export class BroadcastRetryLaterError extends Error {
  constructor(readonly deferred: number) {
    super(`${deferred} recipient(s) rate-limited by WhatsApp; retrying later`)
    this.name = 'BroadcastRetryLaterError'
  }
}

// ── Sending one message ────────────────────────────────────────────────────

export type SendTemplateFn = (args: SendTemplateMessageArgs) => Promise<MetaSendResult>

/**
 * Sends to the normalized number, retrying with phone variants only on the
 * sandbox "not in allowed list" error (a missing/extra trunk 0 can cause it).
 */
export async function sendTemplateToPhone(
  send: SendTemplateFn,
  phone: string,
  args: Omit<SendTemplateMessageArgs, 'to'>,
): Promise<MetaSendResult> {
  const variants = phoneVariants(phone)
  let lastError: unknown = new Error('Invalid phone number format')
  for (const to of variants) {
    try {
      return await send({ ...args, to })
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      if (isRecipientNotRegisteredError(message) || !isRecipientNotAllowedError(message)) break
    }
  }
  throw lastError
}

export function renderTemplateText(body: string | null, templateName: string, params: string[]): string {
  if (!body) return `[Template: ${templateName}]`
  return body.replace(/\{\{(\d+)\}\}/g, (_, raw) => params[Number(raw) - 1] ?? '')
}

// ── Processing a broadcast ─────────────────────────────────────────────────

export interface BroadcastSenderDeps {
  store: BroadcastStore
  send: SendTemplateFn
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  /** Messages per second for one broadcast. */
  ratePerSecond?: number
  /** Waits before each in-process retry of a rate-limited recipient. */
  retryDelaysMs?: number[]
  batchSize?: number
  log?: (message: string) => void
}

export interface ProcessBroadcastOptions {
  /** On the job's last attempt, still-rate-limited recipients are failed instead of retried. */
  finalAttempt: boolean
}

export type ProcessOutcome = 'not_found' | 'inactive' | 'cancelled' | 'stopped' | 'finished'

export interface ProcessBroadcastResult {
  outcome: ProcessOutcome
  sent: number
  failed: number
  skipped: number
}

export const DEFAULT_RATE_PER_SECOND = 20
const MAX_INTERVAL_MS = 2000

export async function processBroadcast(
  broadcastId: string,
  deps: BroadcastSenderDeps,
  options: ProcessBroadcastOptions,
): Promise<ProcessBroadcastResult> {
  const { store, send } = deps
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const now = deps.now ?? Date.now
  const log = deps.log ?? (() => {})
  const retryDelays = deps.retryDelaysMs ?? [2_000, 8_000]
  const batchSize = deps.batchSize ?? 10
  let intervalMs = 1000 / Math.max(0.1, deps.ratePerSecond ?? DEFAULT_RATE_PER_SECOND)

  const result: ProcessBroadcastResult = { outcome: 'finished', sent: 0, failed: 0, skipped: 0 }

  const broadcast = await store.getBroadcast(broadcastId)
  if (!broadcast) return { ...result, outcome: 'not_found' }
  if (!(await store.claimForSending(broadcastId))) return { ...result, outcome: 'inactive' }

  const config = await store.getSenderConfig(broadcast.user_id)
  if (!config) {
    await store.failAllPending(broadcastId, NO_SENDER_REASON)
    await store.refreshStats(broadcastId)
    await store.finish(broadcastId, 'failed', NO_SENDER_REASON)
    return { ...result, outcome: 'stopped' }
  }

  const variables = parseVariableMappings(broadcast.template_variables)
  const headerMedia = parseHeaderMedia(broadcast.header_media)
  const language = broadcast.template_language || 'en_US'
  const templateBody = await store.getTemplateBody(broadcast.user_id, broadcast.template_name, language)

  let lastSendAt = -Infinity
  async function throttle() {
    const wait = lastSendAt + intervalMs - now()
    if (wait > 0) await sleep(wait)
    lastSendAt = now()
  }

  const deferred = new Map<string, string>()
  let stopReason: string | null = null

  outer: while (true) {
    // Picks up a cancel (or delete) between batches.
    if ((await store.getStatus(broadcastId)) !== 'sending') {
      await store.refreshStats(broadcastId).catch(() => {})
      return { ...result, outcome: 'cancelled' }
    }

    const batch = await store.listPendingRecipients(broadcastId, batchSize, [...deferred.keys()])
    if (batch.length === 0) break

    for (const recipient of batch) {
      const contact = recipient.contact
      if (!contact) {
        await store.markUnsent(recipient.id, 'failed', 'Contact was deleted before sending.')
        result.failed++
        continue
      }
      if (contact.opted_out_at) {
        await store.markUnsent(recipient.id, 'skipped', OPTED_OUT_REASON)
        result.skipped++
        continue
      }
      const phone = normalizePhoneForMetaIndia(contact.phone ?? '')
      if (!isValidE164(phone)) {
        await store.markUnsent(recipient.id, 'failed', 'Invalid phone number format')
        result.failed++
        continue
      }

      const params = resolveVariables(variables, contact, recipient.customValues)

      for (let attempt = 0; ; attempt++) {
        await throttle()
        try {
          const { messageId } = await sendTemplateToPhone(send, phone, {
            phoneNumberId: config.phoneNumberId,
            accessToken: config.accessToken,
            templateName: broadcast.template_name,
            language,
            ...(headerMedia ? { componentParams: { body: params, headerMedia } } : { params }),
          })
          await store.markSent(recipient.id, messageId)
          result.sent++
          try {
            await store.recordMessage({
              userId: broadcast.user_id,
              contactId: contact.id,
              templateName: broadcast.template_name,
              renderedText: renderTemplateText(templateBody, broadcast.template_name, params),
              whatsappMessageId: messageId,
            })
          } catch (err) {
            // Only the inbox copy is lost; the customer got the message.
            log(`could not add broadcast message to inbox: ${err instanceof Error ? err.message : err}`)
          }
          break
        } catch (err) {
          const kind = classifySendError(err)
          const reason = friendlySendError(err)
          if (kind === 'retry') {
            if (metaErrorCode(err) === 130429) intervalMs = Math.min(intervalMs * 2, MAX_INTERVAL_MS)
            if (attempt < retryDelays.length) {
              await sleep(retryDelays[attempt])
              continue
            }
            log(`recipient ${recipient.id} deferred: ${reason}`)
            deferred.set(recipient.id, reason)
            break
          }
          await store.markUnsent(recipient.id, 'failed', reason)
          result.failed++
          if (kind === 'stop') {
            stopReason = reason
            break outer
          }
          break
        }
      }
    }

    await store.refreshStats(broadcastId)
  }

  if (stopReason) {
    await store.failAllPending(broadcastId, stopReason)
    await store.refreshStats(broadcastId)
    await store.finish(broadcastId, 'failed', stopReason)
    return { ...result, outcome: 'stopped' }
  }

  if (deferred.size > 0) {
    if (!options.finalAttempt) {
      await store.refreshStats(broadcastId)
      throw new BroadcastRetryLaterError(deferred.size)
    }
    for (const [id, reason] of deferred) {
      await store.markUnsent(id, 'failed', reason)
      result.failed++
    }
  }

  const counts = await store.refreshStats(broadcastId)
  if (counts.sent_count > 0) {
    await store.finish(broadcastId, 'sent', null)
  } else {
    await store.finish(
      broadcastId,
      'failed',
      counts.failed_count > 0 ? 'No messages could be sent. See each recipient for the reason.' : 'No one to send to: every recipient was skipped.',
    )
  }
  return result
}
