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
  assert.equal(requestedCatalogue([{ from: 'customer', text: 'हाँ।' }]), false)
})

test('records a send confirmation after a catalogue delivery question', () => {
  assert.equal(requestedCatalogue([
    { from: 'agent', text: 'क्या हम आपको इसी व्हाट्सऐप नंबर पर कैटलॉग शेयर कर सकते हैं, या आप शोरूम में अपॉइंटमेंट बुक करना चाहेंगे?' },
    { from: 'customer', text: 'हां जी भेज दो।' },
  ]), true)
})

test('records a one-word catalogue choice after the agent asks catalogue or appointment', () => {
  assert.equal(requestedCatalogue([
    { from: 'agent', text: 'क्या आप कैटलॉग चाहते हैं या शोरूम अपॉइंटमेंट बुक करना चाहेंगे?' },
    { from: 'customer', text: 'Catalog.' },
  ]), true)
  assert.equal(requestedCatalogue([
    { from: 'agent', text: 'क्या आप कैटलॉग चाहते हैं या शोरूम अपॉइंटमेंट बुक करना चाहेंगे?' },
    { from: 'customer', text: 'कैटलॉग।' },
  ]), true)
})

test('accepts yes after a catalogue offer but not after an unrelated question', () => {
  assert.equal(requestedCatalogue([
    { from: 'agent', text: 'क्या आप कैटलॉग चाहते हैं या शोरूम अपॉइंटमेंट बुक करना चाहेंगे?' },
    { from: 'customer', text: 'हाँ।' },
  ]), true)
  assert.equal(requestedCatalogue([
    { from: 'agent', text: 'क्या आप कैटलॉग चाहते हैं या शोरूम अपॉइंटमेंट बुक करना चाहेंगे?' },
    { from: 'customer', text: 'जी हाँ।' },
  ]), true)
  assert.equal(requestedCatalogue([
    { from: 'agent', text: 'आपको कौन सा साइज़ चाहिए?' },
    { from: 'customer', text: 'Catalog.' },
  ]), false)
  assert.equal(requestedCatalogue([
    { from: 'agent', text: 'क्या आप शोरूम अपॉइंटमेंट बुक करना चाहेंगे?' },
    { from: 'customer', text: 'हाँ।' },
  ]), false)
})

test('does not confuse an appointment reply with a catalogue request', () => {
  assert.equal(requestedCatalogue([
    { from: 'agent', text: 'क्या आप शोरूम में अपॉइंटमेंट बुक करना चाहेंगे?' },
    { from: 'customer', text: 'हां जी बुक कर दो।' },
  ]), false)

  assert.equal(requestedCatalogue([
    { from: 'agent', text: 'क्या हम आपको इसी व्हाट्सऐप नंबर पर कैटलॉग शेयर कर सकते हैं, या आप शोरूम में अपॉइंटमेंट बुक करना चाहेंगे?' },
    { from: 'customer', text: 'हाँ, अपॉइंटमेंट बुक कर दीजिए।' },
  ]), false)
})
