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

test('records a send confirmation after a catalogue delivery question', () => {
  assert.equal(requestedCatalogue([
    { from: 'agent', text: 'क्या हम आपको इसी व्हाट्सऐप नंबर पर कैटलॉग शेयर कर सकते हैं, या आप शोरूम में अपॉइंटमेंट बुक करना चाहेंगे?' },
    { from: 'customer', text: 'हां जी भेज दो।' },
  ]), true)
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

test('defaults a bare affirmative to catalogue only after the combined choice', () => {
  const question = 'क्या हम आपको इसी व्हाट्सऐप नंबर पर कैटलॉग शेयर कर सकते हैं, या आप शोरूम में अपॉइंटमेंट बुक करना चाहेंगे?'
  assert.equal(requestedCatalogue([
    { from: 'agent', text: question },
    { from: 'customer', text: 'जी सर।' },
  ]), true)
  assert.equal(requestedCatalogue([
    { from: 'agent', text: question },
    { from: 'customer', text: 'जी सर।\nکر دیجیے.\nଏକଶହ ପାଞ୍ଚ।\nYes.\nHello.' },
  ]), true)
  assert.equal(requestedCatalogue([
    { from: 'agent', text: question },
    { from: 'customer', text: 'जी सर, अपॉइंटमेंट बुक कर दीजिए।' },
  ]), false)
  assert.equal(requestedCatalogue([
    { from: 'agent', text: 'क्या मैं आपको हमारे ह्यूमन एजेंट से कनेक्ट कर दूँ?' },
    { from: 'customer', text: 'जी सर।' },
  ]), false)
})
