import { describe, expect, it } from 'vitest'
import { MetaApiError, type SendTemplateMessageArgs } from '@/lib/whatsapp/meta-api'
import {
  BroadcastRetryLaterError,
  INTERRUPTED_REASON,
  MISSED_SCHEDULE_REASON,
  OPTED_OUT_REASON,
  NO_SENDER_REASON,
  UNKNOWN_OUTCOME_REASON,
  classifySendError,
  processBroadcast,
  type BroadcastRecord,
  type BroadcastStore,
  type PendingRecipient,
} from '@/lib/whatsapp/broadcast-sender'

interface FakeRecipient {
  id: string
  status: string
  error: string | null
  messageId: string | null
  contact: PendingRecipient['contact']
  customValues: Record<string, string>
}

function contact(id: string, phone: string, extra: Partial<NonNullable<PendingRecipient['contact']>> = {}) {
  return { id, phone, name: `Name ${id}`, email: null, company: null, opted_out_at: null, ...extra }
}

function makeStore(opts: {
  broadcast?: Partial<BroadcastRecord>
  recipients: Array<{ id: string; contact: PendingRecipient['contact']; customValues?: Record<string, string> }>
  config?: { phoneNumberId: string; accessToken: string } | null
  templateBody?: string | null
}) {
  const broadcast: BroadcastRecord = {
    id: 'b1',
    user_id: 'u1',
    status: 'sending',
    template_name: 'promo',
    template_language: 'en',
    template_variables: { '1': { type: 'field', value: 'name' }, '2': { type: 'static', value: '20%' } },
    header_media: null,
    scheduled_at: null,
    ...opts.broadcast,
  }
  const recipients: FakeRecipient[] = opts.recipients.map((r) => ({
    id: r.id,
    status: 'pending',
    error: null,
    messageId: null,
    contact: r.contact,
    customValues: r.customValues ?? {},
  }))
  const state = {
    broadcast,
    recipients,
    finished: null as null | { status: string; error: string | null },
    messages: [] as Array<{ contactId: string; renderedText: string; whatsappMessageId: string }>,
    statusChecks: 0,
    /** Called on each getStatus so tests can cancel mid-send. */
    onStatusCheck: (_n: number) => {},
  }
  const byId = (id: string) => recipients.find((r) => r.id === id)!
  const store: BroadcastStore = {
    async getBroadcast(id) {
      return id === broadcast.id ? { ...broadcast } : null
    },
    async claimForSending(id) {
      if (id !== broadcast.id || !['scheduled', 'sending'].includes(broadcast.status)) return false
      broadcast.status = 'sending'
      return true
    },
    async getStatus() {
      state.onStatusCheck(++state.statusChecks)
      return broadcast.status
    },
    async getSenderConfig() {
      return opts.config === undefined ? { phoneNumberId: 'pn1', accessToken: 'tok' } : opts.config
    },
    async getTemplateBody() {
      return opts.templateBody === undefined ? 'Hi {{1}}, get {{2}} off' : opts.templateBody
    },
    async claimNextRecipient(_b, exclude) {
      const r = recipients.find((x) => x.status === 'pending' && !exclude.includes(x.id))
      if (!r) return null
      r.status = 'sending'
      return { id: r.id, contact: r.contact, customValues: r.customValues }
    },
    async releaseRecipient(id) {
      if (byId(id).status === 'sending') byId(id).status = 'pending'
    },
    async markSent(id, messageId) {
      Object.assign(byId(id), { status: 'sent', messageId, error: null })
    },
    async markUnsent(id, status, error) {
      Object.assign(byId(id), { status, error })
    },
    async closePending(_b, status, error) {
      for (const r of recipients) if (r.status === 'pending') Object.assign(r, { status, error })
    },
    async failInFlight(_b, error) {
      for (const r of recipients) if (r.status === 'sending') Object.assign(r, { status: 'failed', error })
    },
    async refreshStats() {
      return {
        sent_count: recipients.filter((r) => r.status === 'sent').length,
        failed_count: recipients.filter((r) => r.status === 'failed').length,
      }
    },
    async finish(_b, status, error) {
      if (broadcast.status !== 'sending') return
      broadcast.status = status
      state.finished = { status, error }
    },
    async recordMessage(args) {
      state.messages.push(args)
    },
  }
  return { store, state, byId }
}

/** Fake Graph API: `script` decides per call; default is success. */
function makeSender(script: (args: SendTemplateMessageArgs, call: number) => Error | null = () => null) {
  const calls: SendTemplateMessageArgs[] = []
  const send = async (args: SendTemplateMessageArgs) => {
    calls.push(args)
    const err = script(args, calls.length)
    if (err) throw err
    return { messageId: `wamid.${calls.length}` }
  }
  return { send, calls }
}

function fakeClock() {
  let t = 0
  const sleeps: number[] = []
  return {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms)
      t += ms
    },
    sleeps,
  }
}

const metaError = (code: number, message = 'error') => new MetaApiError(`(#${code}) ${message}`, 400, code)

describe('processBroadcast', () => {
  it('sends to every pending recipient with their own variables and logs the message to the inbox', async () => {
    const { store, state } = makeStore({
      recipients: [
        { id: 'r1', contact: contact('c1', '9876543210') },
        { id: 'r2', contact: contact('c2', '+91 98765 43211', { name: 'Asha' }) },
      ],
    })
    const { send, calls } = makeSender()
    const result = await processBroadcast('b1', { store, send, ...fakeClock() }, { finalAttempt: false })

    expect(result).toMatchObject({ outcome: 'finished', sent: 2, failed: 0 })
    expect(calls.map((c) => c.to)).toEqual(['919876543210', '919876543211'])
    expect(calls[1].params).toEqual(['Asha', '20%'])
    expect(calls[1]).toMatchObject({ phoneNumberId: 'pn1', accessToken: 'tok', templateName: 'promo', language: 'en' })
    expect(state.recipients.map((r) => [r.status, r.messageId])).toEqual([
      ['sent', 'wamid.1'],
      ['sent', 'wamid.2'],
    ])
    expect(state.messages[1]).toEqual({
      userId: 'u1',
      contactId: 'c2',
      templateName: 'promo',
      renderedText: 'Hi Asha, get 20% off',
      whatsappMessageId: 'wamid.2',
    })
    expect(state.finished).toEqual({ status: 'sent', error: null })
  })

  it('sends the header photo with the body variables', async () => {
    const { store } = makeStore({
      broadcast: { header_media: { type: 'image', id: 'media-123' } },
      recipients: [{ id: 'r1', contact: contact('c1', '919876543210') }],
    })
    const { send, calls } = makeSender()
    await processBroadcast('b1', { store, send, ...fakeClock() }, { finalAttempt: false })
    expect(calls[0].componentParams).toEqual({
      body: ['Name c1', '20%'],
      headerMedia: { type: 'image', id: 'media-123' },
    })
    expect(calls[0].params).toBeUndefined()
  })

  it('fills custom-field variables from the contact', async () => {
    const { store } = makeStore({
      broadcast: { template_variables: { '1': { type: 'custom_field', value: 'f-city' } } },
      recipients: [{ id: 'r1', contact: contact('c1', '919876543210'), customValues: { 'f-city': 'Pune' } }],
    })
    const { send, calls } = makeSender()
    await processBroadcast('b1', { store, send, ...fakeClock() }, { finalAttempt: false })
    expect(calls[0].params).toEqual(['Pune'])
  })

  it('skips contacts who opted out after the broadcast was created', async () => {
    const { store, state } = makeStore({
      recipients: [
        { id: 'r1', contact: contact('c1', '919876543210', { opted_out_at: new Date() }) },
        { id: 'r2', contact: contact('c2', '919876543211') },
      ],
    })
    const { send, calls } = makeSender()
    const result = await processBroadcast('b1', { store, send, ...fakeClock() }, { finalAttempt: false })
    expect(calls).toHaveLength(1)
    expect(state.recipients[0]).toMatchObject({ status: 'skipped', error: OPTED_OUT_REASON })
    expect(result).toMatchObject({ sent: 1, skipped: 1 })
  })

  it('fails invalid numbers and deleted contacts without calling Meta', async () => {
    const { store, state } = makeStore({
      recipients: [
        { id: 'r1', contact: contact('c1', '12') },
        { id: 'r2', contact: null },
      ],
    })
    const { send, calls } = makeSender()
    await processBroadcast('b1', { store, send, ...fakeClock() }, { finalAttempt: false })
    expect(calls).toHaveLength(0)
    expect(state.recipients.map((r) => r.status)).toEqual(['failed', 'failed'])
    expect(state.finished?.status).toBe('failed')
  })

  it('retries a 130429 rate limit after a pause and slows down', async () => {
    const { store, state } = makeStore({
      recipients: [
        { id: 'r1', contact: contact('c1', '919876543210') },
        { id: 'r2', contact: contact('c2', '919876543211') },
      ],
    })
    const { send, calls } = makeSender((_a, n) => (n === 1 ? metaError(130429, 'Rate limit hit') : null))
    const clock = fakeClock()
    await processBroadcast('b1', { store, send, ...clock, ratePerSecond: 20, retryDelaysMs: [500] }, { finalAttempt: false })
    expect(calls).toHaveLength(3)
    expect(state.recipients.map((r) => r.status)).toEqual(['sent', 'sent'])
    expect(clock.sleeps).toContain(500)
    // 50 ms between sends at 20/s, doubled to 100 ms after the rate limit.
    expect(clock.sleeps.at(-1)).toBe(100)
  })

  it('leaves a still-rate-limited recipient pending for a later job retry, then fails it on the last attempt', async () => {
    const { store, state } = makeStore({
      recipients: [
        { id: 'r1', contact: contact('c1', '919876543210') },
        { id: 'r2', contact: contact('c2', '919876543211') },
      ],
    })
    const pairLimited = (a: SendTemplateMessageArgs) => (a.to === '919876543210' ? metaError(131056, 'pair rate limit') : null)
    const first = makeSender(pairLimited)
    await expect(
      processBroadcast('b1', { store, send: first.send, ...fakeClock(), retryDelaysMs: [10] }, { finalAttempt: false }),
    ).rejects.toBeInstanceOf(BroadcastRetryLaterError)
    expect(state.recipients.map((r) => r.status)).toEqual(['pending', 'sent'])
    expect(first.calls.filter((c) => c.to === '919876543210')).toHaveLength(2)
    expect(state.finished).toBeNull()

    // The retried job only touches what is still pending.
    const last = makeSender(pairLimited)
    await processBroadcast('b1', { store, send: last.send, ...fakeClock(), retryDelaysMs: [] }, { finalAttempt: true })
    expect(last.calls.map((c) => c.to)).toEqual(['919876543210'])
    expect(state.recipients[0].status).toBe('failed')
    expect(state.recipients[0].error).toMatch(/too fast|too many/i)
    expect(state.finished).toEqual({ status: 'sent', error: null })
  })

  it('does not retry a permanent per-recipient error', async () => {
    const { store, state } = makeStore({
      recipients: [
        { id: 'r1', contact: contact('c1', '919876543210') },
        { id: 'r2', contact: contact('c2', '919876543211') },
      ],
    })
    const { send, calls } = makeSender((a) => (a.to === '919876543210' ? metaError(131026, 'Message undeliverable') : null))
    await processBroadcast('b1', { store, send, ...fakeClock() }, { finalAttempt: false })
    expect(calls).toHaveLength(2)
    expect(state.recipients[0]).toMatchObject({ status: 'failed' })
    expect(state.recipients[0].error).toMatch(/may not be on WhatsApp/)
    expect(state.recipients[1].status).toBe('sent')
  })

  it('stops the whole broadcast on an error every recipient would hit (expired token)', async () => {
    const { store, state } = makeStore({
      recipients: [
        { id: 'r1', contact: contact('c1', '919876543210') },
        { id: 'r2', contact: contact('c2', '919876543211') },
        { id: 'r3', contact: contact('c3', '919876543212') },
      ],
    })
    const { send, calls } = makeSender(() => metaError(190, 'Error validating access token'))
    const result = await processBroadcast('b1', { store, send, ...fakeClock() }, { finalAttempt: false })
    expect(result.outcome).toBe('stopped')
    expect(calls).toHaveLength(1)
    expect(state.recipients.every((r) => r.status === 'failed')).toBe(true)
    expect(state.finished?.status).toBe('failed')
    expect(state.finished?.error).toMatch(/access token/i)
  })

  it('tries phone variants on the sandbox "not in allowed list" error', async () => {
    const { store, state } = makeStore({ recipients: [{ id: 'r1', contact: contact('c1', '919876543210') }] })
    const { send, calls } = makeSender((_a, n) => (n === 1 ? metaError(131030, 'Recipient phone number not in allowed list') : null))
    await processBroadcast('b1', { store, send, ...fakeClock() }, { finalAttempt: false })
    expect(calls.length).toBe(2)
    expect(calls[1].to).not.toBe(calls[0].to)
    expect(state.recipients[0].status).toBe('sent')
  })

  it('stops between batches when the broadcast is cancelled', async () => {
    const { store, state } = makeStore({
      recipients: Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, contact: contact(`c${i}`, `91987654321${i}`) })),
    })
    state.onStatusCheck = (n) => {
      if (n === 2) state.broadcast.status = 'cancelled'
    }
    const { send, calls } = makeSender()
    const result = await processBroadcast('b1', { store, send, ...fakeClock(), statusCheckEvery: 2 }, { finalAttempt: false })
    expect(result.outcome).toBe('cancelled')
    expect(calls).toHaveLength(2)
    expect(state.finished).toBeNull()
  })

  it('does nothing for a broadcast that is cancelled, finished or gone', async () => {
    for (const status of ['cancelled', 'sent', 'draft']) {
      const { store } = makeStore({ broadcast: { status }, recipients: [{ id: 'r1', contact: contact('c1', '919876543210') }] })
      const { send, calls } = makeSender()
      const result = await processBroadcast('b1', { store, send, ...fakeClock() }, { finalAttempt: false })
      expect(result.outcome).toBe('inactive')
      expect(calls).toHaveLength(0)
    }
    const { store } = makeStore({ recipients: [] })
    const { send } = makeSender()
    expect((await processBroadcast('missing', { store, send }, { finalAttempt: false })).outcome).toBe('not_found')
  })

  it('starts a scheduled broadcast', async () => {
    const { store, state } = makeStore({
      broadcast: { status: 'scheduled' },
      recipients: [{ id: 'r1', contact: contact('c1', '919876543210') }],
    })
    const { send } = makeSender()
    await processBroadcast('b1', { store, send, ...fakeClock() }, { finalAttempt: false })
    expect(state.finished?.status).toBe('sent')
  })

  it('fails every recipient when WhatsApp is not connected', async () => {
    const { store, state } = makeStore({ config: null, recipients: [{ id: 'r1', contact: contact('c1', '919876543210') }] })
    const { send, calls } = makeSender()
    await processBroadcast('b1', { store, send }, { finalAttempt: false })
    expect(calls).toHaveLength(0)
    expect(state.recipients[0]).toMatchObject({ status: 'failed', error: NO_SENDER_REASON })
    expect(state.finished).toEqual({ status: 'failed', error: NO_SENDER_REASON })
  })

  it('throttles sends to the configured rate', async () => {
    const { store } = makeStore({
      recipients: Array.from({ length: 4 }, (_, i) => ({ id: `r${i}`, contact: contact(`c${i}`, `91987654321${i}`) })),
    })
    const { send } = makeSender()
    const clock = fakeClock()
    await processBroadcast('b1', { store, send, ...clock, ratePerSecond: 5 }, { finalAttempt: false })
    expect(clock.sleeps).toEqual([200, 200, 200])
  })

  it('keeps the send when only the inbox copy fails', async () => {
    const { store, state } = makeStore({ recipients: [{ id: 'r1', contact: contact('c1', '919876543210') }] })
    store.recordMessage = async () => {
      throw new Error('db hiccup')
    }
    const { send } = makeSender()
    await processBroadcast('b1', { store, send, ...fakeClock() }, { finalAttempt: false })
    expect(state.recipients[0].status).toBe('sent')
    expect(state.finished?.status).toBe('sent')
  })
})

describe('processBroadcast: no duplicate sends', () => {
  it('never sends to the same recipient twice when two runs of the job overlap', async () => {
    const { store, state } = makeStore({
      recipients: Array.from({ length: 6 }, (_, i) => ({ id: `r${i}`, contact: contact(`c${i}`, `91987654321${i}`) })),
    })
    const calls: string[] = []
    const send = async (args: SendTemplateMessageArgs) => {
      calls.push(args.to)
      await new Promise((r) => setTimeout(r, 1))
      return { messageId: `wamid.${calls.length}` }
    }
    const deps = { store, send, sleep: async () => {} }
    await Promise.all([
      processBroadcast('b1', deps, { finalAttempt: false }),
      processBroadcast('b1', deps, { finalAttempt: false }),
    ])
    expect([...calls].sort()).toEqual(state.recipients.map((_, i) => `91987654321${i}`))
    expect(state.recipients.every((r) => r.status === 'sent')).toBe(true)
  })

  it('fails a recipient a crashed run left mid-send instead of sending again', async () => {
    const { store, state } = makeStore({
      recipients: [
        { id: 'r1', contact: contact('c1', '919876543210') },
        { id: 'r2', contact: contact('c2', '919876543211') },
      ],
    })
    state.recipients[0].status = 'sending'
    const { send, calls } = makeSender()
    await processBroadcast('b1', { store, send, ...fakeClock() }, { finalAttempt: false })
    expect(calls.map((c) => c.to)).toEqual(['919876543211'])
    expect(state.recipients[0]).toMatchObject({ status: 'failed', error: INTERRUPTED_REASON })
  })

  it('does not retry when the connection broke after the request may have reached Meta', async () => {
    const { store, state } = makeStore({ recipients: [{ id: 'r1', contact: contact('c1', '919876543210') }] })
    const reset = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })
    const { send, calls } = makeSender(() => reset)
    await processBroadcast('b1', { store, send, ...fakeClock() }, { finalAttempt: false })
    expect(calls).toHaveLength(1)
    expect(state.recipients[0]).toMatchObject({ status: 'failed', error: UNKNOWN_OUTCOME_REASON })
  })

  it('retries when the connection was refused before anything was sent', async () => {
    const { store, state } = makeStore({ recipients: [{ id: 'r1', contact: contact('c1', '919876543210') }] })
    const refused = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
    const { send, calls } = makeSender((_a, n) => (n === 1 ? refused : null))
    await processBroadcast('b1', { store, send, ...fakeClock() }, { finalAttempt: false })
    expect(calls).toHaveLength(2)
    expect(state.recipients[0].status).toBe('sent')
  })
})

describe('processBroadcast: schedule', () => {
  const HOUR = 60 * 60 * 1000

  it('fails a scheduled broadcast that runs more than two hours late instead of sending it', async () => {
    const { store, state } = makeStore({
      broadcast: { status: 'scheduled', scheduled_at: new Date(-3 * HOUR) },
      recipients: [{ id: 'r1', contact: contact('c1', '919876543210') }],
    })
    const { send, calls } = makeSender()
    const result = await processBroadcast('b1', { store, send, ...fakeClock() }, { finalAttempt: false })
    expect(result.outcome).toBe('missed')
    expect(calls).toHaveLength(0)
    expect(state.recipients[0]).toMatchObject({ status: 'skipped', error: MISSED_SCHEDULE_REASON })
    expect(state.finished).toEqual({ status: 'failed', error: MISSED_SCHEDULE_REASON })
  })

  it('still sends a scheduled broadcast that is only a little late', async () => {
    const { store, state } = makeStore({
      broadcast: { status: 'scheduled', scheduled_at: new Date(-HOUR) },
      recipients: [{ id: 'r1', contact: contact('c1', '919876543210') }],
    })
    const { send } = makeSender()
    await processBroadcast('b1', { store, send, ...fakeClock() }, { finalAttempt: false })
    expect(state.finished?.status).toBe('sent')
  })
})

describe('processBroadcast: template-wide errors', () => {
  it('stops on a template parameter mismatch instead of failing everyone one by one', async () => {
    const { store, state } = makeStore({
      recipients: [
        { id: 'r1', contact: contact('c1', '919876543210') },
        { id: 'r2', contact: contact('c2', '919876543211') },
      ],
    })
    const { send, calls } = makeSender(() => metaError(132000, 'Number of parameters does not match'))
    const result = await processBroadcast('b1', { store, send, ...fakeClock() }, { finalAttempt: false })
    expect(result.outcome).toBe('stopped')
    expect(calls).toHaveLength(1)
    expect(state.recipients.map((r) => r.status)).toEqual(['failed', 'failed'])
  })

  it('keeps a missing variable (131008) to that one contact', async () => {
    const { store, state } = makeStore({
      recipients: [
        { id: 'r1', contact: contact('c1', '919876543210') },
        { id: 'r2', contact: contact('c2', '919876543211') },
      ],
    })
    const { send } = makeSender((a) => (a.to === '919876543210' ? metaError(131008, 'Required parameter is missing') : null))
    await processBroadcast('b1', { store, send, ...fakeClock() }, { finalAttempt: false })
    expect(state.recipients.map((r) => r.status)).toEqual(['failed', 'sent'])
  })
})

describe('classifySendError', () => {
  it('retries rate limits, Meta-side errors and refused connections', () => {
    expect(classifySendError(metaError(130429))).toBe('retry')
    expect(classifySendError(metaError(131056))).toBe('retry')
    for (const code of [4, 80007]) expect(classifySendError(metaError(code))).toBe('retry')
    expect(classifySendError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'EAI_AGAIN' } }))).toBe('retry')
    expect(classifySendError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }))).toBe('retry')
  })

  it('treats failures that may have reached Meta as unknown, never retried', () => {
    expect(classifySendError(new MetaApiError('Bad gateway', 502))).toBe('unknown')
    expect(classifySendError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_SOCKET' } }))).toBe('unknown')
    expect(classifySendError(new TypeError('fetch failed'))).toBe('unknown')
    expect(classifySendError(new TypeError('Cannot read properties of undefined'))).toBe('unknown')
  })

  it('stops on template-wide errors and keeps variable errors per contact', () => {
    for (const code of [131048, 131053, 132000, 132005, 132007, 132012]) expect(classifySendError(metaError(code))).toBe('stop')
    for (const code of [131008, 131009]) expect(classifySendError(metaError(code))).toBe('recipient')
  })

  it('reads the code from the message when there is no MetaApiError', () => {
    expect(classifySendError(new Error('(#130429) Rate limit hit'))).toBe('retry')
    expect(classifySendError(new Error('(#131026) Message undeliverable'))).toBe('recipient')
  })

  it('stops on account-wide errors and fails other recipient errors', () => {
    expect(classifySendError(metaError(190))).toBe('stop')
    expect(classifySendError(metaError(132001))).toBe('stop')
    expect(classifySendError(metaError(131026))).toBe('recipient')
    expect(classifySendError(new MetaApiError('Bad request', 400))).toBe('recipient')
  })
})
