import test from 'node:test'
import assert from 'node:assert/strict'
import { failureFromLog, failureFromFeedback, classifyServiceFailure, redactDiagnostic } from '../lib/service-alerts/classify.mjs'
import { inspectVobizBalance } from '../lib/service-alerts/vobiz.mjs'
import { recordServiceFailure } from '../lib/service-alerts/store.mjs'

const timestamp = '2026-10-15T13:02:08.759Z'
const sarvam = '2026-10-15T13:02:08.759000000Z 2026-10-15 13:02:08.759 | ERROR | [run_id=5463] | realtime_feedback_observer.py:266 | DOGRAH_FAILURE [src=stt type=provider_error code=sarvam-connection] [owner=user] ConnectionClosedError: Credits exhausted. Add credits in the API Dashboard.'

test('actual Sarvam log and stored feedback classify and deduplicate the same failure', () => {
  const live = failureFromLog(sarvam)
  const saved = failureFromFeedback({ type: 'rtf-pipeline-error', payload: { error: 'Credits exhausted', processor: 'SarvamSTTService#1313' }, timestamp }, 5463)
  assert.equal(live.service, 'sarvam')
  assert.equal(live.component, 'STT')
  assert.equal(live.code, 'CREDITS_EXHAUSTED')
  assert.equal(live.eventKey, saved.eventKey)
  assert.equal(live.runId, '5463')
  const tts = failureFromFeedback({ type: 'rtf-pipeline-error', payload: { error: 'TTS Error: Credits exhausted', processor: 'SarvamTTSService#1313' }, timestamp }, 5463)
  assert.equal(tts.component, 'TTS')
  assert.notEqual(tts.eventKey, live.eventKey)
})

test('429 credit exhaustion is distinguished from TPM rate limiting', () => {
  const credit = classifyServiceFailure({ processor: 'GroqLLMService', message: 'HTTP 429 insufficient_quota_error', timestamp })
  const rate = classifyServiceFailure({ processor: 'GroqLLMService', message: 'HTTP 429 rate_limit_exceeded tokens per minute', timestamp })
  assert.equal(credit.code, 'CREDITS_EXHAUSTED')
  assert.equal(rate.code, 'RATE_LIMITED')
  assert.equal(rate.severity, 'WARNING')
  assert.equal(credit.service, 'llm')
})

test('LLM timeouts, auth failures and Vobiz balance errors have specific actionable alerts', () => {
  for (const [processor, message, code] of [
    ['GroqLLMService', 'Request timed out', 'NO_RESPONSE'],
    ['SarvamTTSService', '403 invalid_api_key_error', 'AUTHENTICATION_FAILED'],
    ['Vobiz', 'SIP 402 Payment Required', 'CREDITS_EXHAUSTED'],
  ]) {
    const result = classifyServiceFailure({ processor, message, timestamp })
    assert.equal(result.code, code)
    assert.ok(result.action.length > 20)
  }
})

test('ordinary call lifecycle, auth challenges and user transcript text do not become incidents', () => {
  for (const line of [
    'SIP/2.0 401 Unauthorized', 'SIP/2.0 405 Method Not Allowed',
    'USER TRANSCRIPT: Sarvam credits exhausted', 'INFO call_status=user_hangup',
  ]) assert.equal(failureFromLog(line), null)
  assert.equal(failureFromFeedback({ type: 'rtf-bot-text', payload: { text: 'Sarvam failed' } }, 4), null)
})

test('provider messages redact credentials and signed URLs before persistence', () => {
  const result = redactDiagnostic('api_key="my-secret-value" auth_token=abc123 password=secret Bearer my.jwt.token gsk_abcXYZ123 https://recording.invalid/file?secret=123 token-secret-value', ['token-secret-value'])
  for (const secret of ['my-secret-value', 'abc123', 'password=secret', 'my.jwt.token', 'gsk_abcXYZ123', 'recording.invalid', 'token-secret-value']) assert.equal(result.includes(secret), false, secret)
  assert.ok(result.includes('[REDACTED]'))
})

test('Vobiz prepaid low/exhausted balances differ and postpaid debt is not misreported', () => {
  const base = { currency: 'INR', is_postpaid: false, low_balance_threshold: 25 }
  assert.equal(inspectVobizBalance({ ...base, available_balance: 0 }).failure.code, 'CREDITS_EXHAUSTED')
  assert.equal(inspectVobizBalance({ ...base, available_balance: 12 }).failure.code, 'LOW_BALANCE')
  assert.equal(inspectVobizBalance({ ...base, available_balance: 100 }).canResolveCredit, true)
  assert.equal(inspectVobizBalance({ ...base, available_balance: -100, is_postpaid: true }).failure, null)
  assert.throws(() => inspectVobizBalance({ balance: 100 }))
  assert.throws(() => inspectVobizBalance({ ...base, available_balance: 'unknown' }))
})

function storeHarness() {
  let alert
  const events = new Map()
  const tx = {
    serviceAlert: {
      upsert: async ({ create }) => alert ||= { ...create, id: 1, status: 'OPEN', occurrences: 0 },
      update: async ({ data }) => { const { occurrences, ...rest } = data; Object.assign(alert, rest); alert.occurrences += occurrences?.increment || 0; return alert },
    },
    serviceAlertEvent: { createMany: async ({ data: [event] }) => {
      if (events.has(event.eventKey)) return { count: 0 }
      events.set(event.eventKey, event); return { count: 1 }
    } },
  }
  return { prisma: { $transaction: async fn => fn(tx) }, events, get: () => alert }
}

test('repeated pipeline frames, history backfill and collector restarts count one affected call', async () => {
  const store = storeHarness()
  const failure = failureFromLog(sarvam)
  for (let i = 0; i < 100; i++) await recordServiceFailure(store.prisma, failure)
  assert.equal(store.events.size, 1)
  assert.equal(store.get().occurrences, 1)
})

test('resolved incidents stay resolved for replayed/older events, reopen for a new failure', async () => {
  const store = storeHarness()
  await recordServiceFailure(store.prisma, failureFromLog(sarvam))
  Object.assign(store.get(), { status: 'RESOLVED', resolvedAt: new Date('2026-10-15T14:00:00Z') })
  await recordServiceFailure(store.prisma, failureFromLog(sarvam))
  await recordServiceFailure(store.prisma, failureFromLog(sarvam.replaceAll('5463', '5462')))
  assert.equal(store.get().status, 'RESOLVED')
  await recordServiceFailure(store.prisma, failureFromLog(sarvam.replaceAll('5463', '5464').replaceAll('13:02:08.759', '15:02:08.759')))
  assert.equal(store.get().status, 'OPEN')
  assert.equal(store.get().resolvedAt, null)
})

test('ongoing failures reopen a manually cleared alert even in the same call', async () => {
  const store = storeHarness()
  await recordServiceFailure(store.prisma, failureFromLog(sarvam))
  Object.assign(store.get(), { status: 'RESOLVED', resolvedAt: new Date('2026-10-15T14:00:00Z') })
  await recordServiceFailure(store.prisma, failureFromLog(sarvam.replaceAll('13:02:08.759', '15:02:08.759')))
  assert.equal(store.get().status, 'OPEN')
  assert.equal(store.get().occurrences, 1)
})
