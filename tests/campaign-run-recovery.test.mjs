import test from 'node:test'
import assert from 'node:assert/strict'
import { isStaleCampaignRun, isTerminalCampaignLifecycle, campaignRecoveryTimeoutMs, isCampaignCapacityError, reconcileAriCampaignRun } from '../lib/campaigns/run-recovery.mjs'

test('terminal campaign lifecycle ignores active telephony updates but accepts hangups', () => {
  for (const status of ['ringing', 'in_progress', 'answered', 'queued', '']) {
    assert.equal(isTerminalCampaignLifecycle(status), false)
  }
  for (const status of ['user_hangup', 'transferred_to_human', 'busy', 'no_answer', 'completed']) {
    assert.equal(isTerminalCampaignLifecycle(status), true)
  }
})

test('stale campaign runs eventually release the sequential queue', () => {
  const started = new Date('2026-09-22T05:14:15.000Z')
  assert.equal(isStaleCampaignRun(started, new Date('2026-09-22T05:24:14.999Z').getTime()), false)
  assert.equal(isStaleCampaignRun(started, new Date('2026-09-22T05:24:15.000Z').getTime()), true)
})

test('unanswered campaign recovery expires at 40 seconds and validates its setting', () => {
  const started = new Date('2026-10-03T05:00:00Z')
  const timeout = campaignRecoveryTimeoutMs('40')
  assert.equal(timeout, 40_000)
  assert.equal(isStaleCampaignRun(started, started.getTime() + 39_999, timeout), false)
  assert.equal(isStaleCampaignRun(started, started.getTime() + 40_000, timeout), true)
  assert.equal(campaignRecoveryTimeoutMs(undefined), 40_000)
  assert.equal(campaignRecoveryTimeoutMs('invalid'), 40_000)
})

test('only an explicit Dograh capacity rejection is safe to retry without another dial', () => {
  assert.equal(isCampaignCapacityError({ status: 429, detail: 'Concurrent call limit reached' }), true)
  for (const error of [new Error('timeout'), { status: 500 }, { status: 429, detail: 'Token limit' }]) {
    assert.equal(isCampaignCapacityError(error), false)
  }
})

test('recovery requires provider confirmation and persisted completion before advancing', async () => {
  for (const status of ['active', 'awaiting_finalization', 'not_ready', undefined]) {
    let calls = 0
    const result = await reconcileAriCampaignRun(async () => { calls++; return { status } }, 42, '/runs/42')
    assert.equal(result, null)
    assert.equal(calls, 1)
  }
  const requests = []
  const completed = { is_completed: true }
  const result = await reconcileAriCampaignRun(async (path, init) => {
    requests.push([path, init?.method])
    return init?.method === 'POST' ? { status: 'recovered' } : completed
  }, 42, '/runs/42')
  assert.equal(result, completed)
  assert.deepEqual(requests, [['/public/agent/runs/42/reconcile', 'POST'], ['/runs/42', undefined]])
  assert.equal(await reconcileAriCampaignRun(async (_, init) => init ? { status: 'recovered' } : { is_completed: false }, 42, '/runs/42'), null)
})

test('recovery failure cannot release the sequential queue', async () => {
  await assert.rejects(reconcileAriCampaignRun(async () => { throw new Error('ARI unavailable') }, 42, '/runs/42'), /ARI unavailable/)
})
