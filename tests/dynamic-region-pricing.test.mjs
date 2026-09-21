import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSekolDograhPrompt } from '../lib/calling-agent/prompt.mjs'

test('custom region pricing replaces only the verified price table', () => {
  const prompt = buildSekolDograhPrompt('+919726418181', {
    liveTransferEnabled: true,
    regionPricing: [
      { region: 'Gujarat/Maharashtra', price12x18: 155, price12x24: 195 },
      { region: 'Kerala', price12x18: 180, price12x24: 225 },
    ],
  })

  assert.match(prompt, /Gujarat\/Maharashtra: 12x18 = ₹155; 12x24 = ₹195/)
  assert.match(prompt, /Kerala: 12x18 = ₹180; 12x24 = ₹225/)
  assert.doesNotMatch(prompt, /Rajasthan: 12x18 = ₹165/)
  assert.match(prompt, /SPOKEN SIZE RULE \(strict\)/)
  assert.match(prompt, /APPOINTMENTS/)
  assert.match(prompt, /CATALOGUE FOLLOW-UP/)
  assert.match(prompt, /immediately call transfer_to_human/)
  assert.match(prompt, /Catalogue and appointment are separate intents/)
  assert.match(prompt, /Any other unclear or mistranscribed reply/)
  assert.match(prompt, /call end_call immediately/i)
})
