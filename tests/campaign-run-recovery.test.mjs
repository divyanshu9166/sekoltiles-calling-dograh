import test from 'node:test'
import assert from 'node:assert/strict'
import { isStaleCampaignRun, isTerminalCampaignLifecycle, campaignRecoveryTimeoutMs, hasConnectedCampaignMedia } from '../lib/campaigns/run-recovery.mjs'

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

test('connected media keeps its conversation grace unless a terminal event is present', () => {
  assert.equal(hasConnectedCampaignMedia({ gathered_context: { channel_name: 'PJSIP/vobiz-1' } }), false)
  assert.equal(hasConnectedCampaignMedia({ gathered_context: { ext_channel_id: 'media-1' } }), true)
  assert.equal(hasConnectedCampaignMedia({ gathered_context: { bridge_id: 'bridge-1', call_status: 'user_hangup' } }), false)
})
