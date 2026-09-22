import test from 'node:test'
import assert from 'node:assert/strict'
import { isStaleCampaignRun, isTerminalCampaignLifecycle } from '../lib/campaigns/run-recovery.mjs'

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
