/**
 * Server-side broadcast sending, run by the BullMQ worker in
 * lib/queues/broadcast-send-worker.ts.
 *
 * One job per broadcast works through its `pending` recipients. Each
 * recipient is claimed atomically (pending → sending) before the request to
 * Meta, so two runs of the same job (e.g. a stalled job picked up again
 * while the first run is still alive) can never send to the same person.
 * A recipient left on `sending` by a crashed run is failed, not re-sent,
 * because we can't know whether Meta accepted it.
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
import { parseStoredSendParams } from '@/lib/whatsapp/template-send-extras'
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
  /** Header/button send parameters shared by every recipient. */
  template_extras?: unknown
  scheduled_at: Date | null
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
  /**
   * Atomically moves one `pending` recipient (not in excludeIds) to
   * `sending` and returns it; null when none is left. Concurrent callers
   * never get the same row.
   */
  claimNextRecipient(broadcastId: string, excludeIds: string[]): Promise<PendingRecipient | null>
  /** sending → pending, for a recipient to retry on a later run. */
  releaseRecipient(recipientId: string): Promise<void>
  markSent(recipientId: string, whatsappMessageId: string): Promise<void>
  markUnsent(recipientId: string, status: 'failed' | 'skipped', error: string): Promise<void>
  /** Every `pending` recipient → status, with the reason. */
  closePending(broadcastId: string, status: 'failed' | 'skipped', error: string): Promise<void>
  /** Every `sending` recipient (claimed by a run that never finished it) → failed. */
  failInFlight(broadcastId: string, error: string): Promise<void>
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

/**
 * Meta answered and refused for now: throughput / pair / app rate limits,
 * or a Meta-side error. Nothing was sent, so retrying later is safe.
 */
const RETRY_CODES = new Set([130429, 131056, 131000, 1, 2, 4, 80007])

/**
 * Wrong for every recipient (token, sender number, account, spam limit, the
 * template itself or its header file), so sending to the rest would only
 * repeat the same failure. 131008/131009 (a missing or invalid variable)
 * stay per recipient: an empty variable is about one contact's data.
 */
const STOP_CODES = new Set([
  190, 10, 200, 368, 131031, 131042, 131048, 133010,
  131053, 132000, 132001, 132005, 132007, 132012, 132015, 132016,
])

/** Socket errors raised before the request left this machine, so Meta never saw it. */
const NEVER_SENT_NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
])

/**
 * retry: surely not sent, try again later. stop: fails the whole broadcast.
 * recipient: this person only. unknown: may or may not have been sent, so
 * it is never retried (a retry could send the customer the message twice).
 */
export type SendErrorKind = 'retry' | 'stop' | 'recipient' | 'unknown'

export function metaErrorCode(err: unknown): number | undefined {
  if (err instanceof MetaApiError && err.code !== undefined) return err.code
  const message = err instanceof Error ? err.message : String(err)
  const match = /\(#(\d+)\)/.exec(message)
  return match ? Number(match[1]) : undefined
}

/** Node's fetch throws TypeError('fetch failed') with the socket error as `cause`. */
function networkErrorCode(err: unknown): string | undefined {
  let current: unknown = err
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string') return code
    current = (current as { cause?: unknown }).cause
  }
  return undefined
}

export function classifySendError(err: unknown): SendErrorKind {
  const code = metaErrorCode(err)
  if (code !== undefined) {
    if (RETRY_CODES.has(code)) return 'retry'
    if (STOP_CODES.has(code)) return 'stop'
    return 'recipient'
  }
  // A 5xx without Meta's error body (e.g. a proxy timeout) may have gone through.
  if (err instanceof MetaApiError) return err.httpStatus >= 500 ? 'unknown' : 'recipient'
  const network = networkErrorCode(err)
  if (network && NEVER_SENT_NETWORK_CODES.has(network)) return 'retry'
  // Resets, timeouts, or a bad 200 body: the request may have reached Meta.
  return 'unknown'
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
export const UNKNOWN_OUTCOME_REASON =
  'Outcome unknown: the connection to WhatsApp broke during the request, so the message may or may not have been sent. Not retried, to avoid sending it twice.'
export const INTERRUPTED_REASON =
  'Outcome unknown: sending stopped while this message was in progress, so it may or may not have been sent. Not retried, to avoid sending it twice.'
export const MISSED_SCHEDULE_REASON =
  'Missed the scheduled time (the server or its queue was down), so nothing was sent. Schedule the broadcast again.'

/** How late a scheduled broadcast may still start. After that it is failed, not sent at a random hour. */
export const MISSED_SCHEDULE_GRACE_MS = 2 * 60 * 60 * 1000

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
  /** Re-read the broadcast status (to notice a cancel) after this many recipients. */
  statusCheckEvery?: number
  log?: (message: string) => void
}

export interface ProcessBroadcastOptions {
  /** On the job's last attempt, still-rate-limited recipients are failed instead of retried. */
  finalAttempt: boolean
}

export type ProcessOutcome = 'not_found' | 'inactive' | 'missed' | 'cancelled' | 'stopped' | 'finished'

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
  const statusCheckEvery = Math.max(1, deps.statusCheckEvery ?? 10)
  let intervalMs = 1000 / Math.max(0.1, deps.ratePerSecond ?? DEFAULT_RATE_PER_SECOND)

  const result: ProcessBroadcastResult = { outcome: 'finished', sent: 0, failed: 0, skipped: 0 }

  const broadcast = await store.getBroadcast(broadcastId)
  if (!broadcast) return { ...result, outcome: 'not_found' }
  const missedSchedule =
    broadcast.status === 'scheduled' &&
    !!broadcast.scheduled_at &&
    now() - broadcast.scheduled_at.getTime() > MISSED_SCHEDULE_GRACE_MS
  if (!(await store.claimForSending(broadcastId))) return { ...result, outcome: 'inactive' }

  if (missedSchedule) {
    await store.closePending(broadcastId, 'skipped', MISSED_SCHEDULE_REASON)
    await store.refreshStats(broadcastId)
    await store.finish(broadcastId, 'failed', MISSED_SCHEDULE_REASON)
    return { ...result, outcome: 'missed' }
  }

  // Claimed by an earlier run that died mid-request: it may have been sent.
  await store.failInFlight(broadcastId, INTERRUPTED_REASON)

  const config = await store.getSenderConfig(broadcast.user_id)
  if (!config) {
    await store.closePending(broadcastId, 'failed', NO_SENDER_REASON)
    await store.refreshStats(broadcastId)
    await store.finish(broadcastId, 'failed', NO_SENDER_REASON)
    return { ...result, outcome: 'stopped' }
  }

  const variables = parseVariableMappings(broadcast.template_variables)
  const headerMedia = parseHeaderMedia(broadcast.header_media)
  const extrasParams = parseStoredSendParams(broadcast.template_extras)
  const useComponents = !!headerMedia || Object.keys(extrasParams).length > 0
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
  let processed = 0

  while (true) {
    if (processed % statusCheckEvery === 0) {
      // Picks up a cancel (or delete).
      if ((await store.getStatus(broadcastId)) !== 'sending') {
        await store.refreshStats(broadcastId).catch(() => {})
        return { ...result, outcome: 'cancelled' }
      }
      if (processed > 0) await store.refreshStats(broadcastId)
    }

    const recipient = await store.claimNextRecipient(broadcastId, [...deferred.keys()])
    if (!recipient) break
    processed++

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
          ...(useComponents
            ? { componentParams: { body: params, ...(headerMedia ? { headerMedia } : {}), ...extrasParams } }
            : { params }),
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
        if (kind === 'retry') {
          if (metaErrorCode(err) === 130429) intervalMs = Math.min(intervalMs * 2, MAX_INTERVAL_MS)
          if (attempt < retryDelays.length) {
            await sleep(retryDelays[attempt])
            continue
          }
          const reason = friendlySendError(err)
          log(`recipient ${recipient.id} deferred: ${reason}`)
          await store.releaseRecipient(recipient.id)
          deferred.set(recipient.id, reason)
          break
        }
        const reason = kind === 'unknown' ? UNKNOWN_OUTCOME_REASON : friendlySendError(err)
        if (kind === 'unknown') log(`recipient ${recipient.id} outcome unknown: ${err instanceof Error ? err.message : err}`)
        await store.markUnsent(recipient.id, 'failed', reason)
        result.failed++
        if (kind === 'stop') stopReason = reason
        break
      }
    }
    if (stopReason) break
  }

  if (stopReason) {
    await store.closePending(broadcastId, 'failed', stopReason)
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
