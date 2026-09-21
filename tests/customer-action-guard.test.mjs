import test from 'node:test'
import assert from 'node:assert/strict'
import { isCatalogueMisroutedToAppointment } from '../lib/calling-agent/customer-action-guard.mjs'

test('blocks a catalogue request misrouted to appointment check', () => {
  assert.equal(isCatalogueMisroutedToAppointment({ action: 'check', purpose: 'catalog' }), true)
  assert.equal(isCatalogueMisroutedToAppointment({ action: 'book', reason: 'कैटलॉग शेयर करना है' }), true)
})

test('allows real appointments and callbacks', () => {
  assert.equal(isCatalogueMisroutedToAppointment({ action: 'check', purpose: 'showroom appointment' }), false)
  assert.equal(isCatalogueMisroutedToAppointment({ action: 'book', purpose: 'catalog showroom visit', date: '2026-09-22', time: '14:00' }), false)
  assert.equal(isCatalogueMisroutedToAppointment({ action: 'callback', reason: 'catalog follow-up' }), false)
})
