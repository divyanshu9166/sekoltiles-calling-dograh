import test from 'node:test'
import assert from 'node:assert/strict'
import { requestedCatalogue } from '../lib/catalogue/detection.mjs'

test('records an explicit catalogue request from a customer transcript', () => {
  assert.equal(requestedCatalogue([
    { from: 'agent', text: 'क्या हम catalogue share करें?' },
    { from: 'customer', text: 'हाँ, मुझे कैटलॉग व्हाट्सऐप पर भेज दीजिए।' },
  ]), true)
})

test('does not treat a catalogue refusal or unrelated yes as a request', () => {
  assert.equal(requestedCatalogue([{ from: 'customer', text: 'मुझे कैटलॉग नहीं चाहिए।' }]), false)
  assert.equal(requestedCatalogue([{ from: 'customer', text: 'हाँ, appointment book कर दीजिए।' }]), false)
})
