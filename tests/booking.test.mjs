import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeCustomerPhone, resolveCustomerPhone, resolveAppointmentDate, isSundayAppointmentDate, nextOpenAppointmentDate, isPastAppointmentSlot, normalizeAppointmentTime, sanitizeCustomerName } from '../lib/appointments/booking.ts'

test('sanitizeCustomerName strips concatenated phone numbers and generic values', () => {
  assert.equal(sanitizeCustomerName('puneet jurel8077902205'), 'puneet jurel')
  assert.equal(sanitizeCustomerName('puneet jurel 8077902205'), 'puneet jurel')
  assert.equal(sanitizeCustomerName('puneet jurel - +918077902205'), 'puneet jurel')
  assert.equal(sanitizeCustomerName('8077902205'), '')
  assert.equal(sanitizeCustomerName('+918077902205'), '')
  assert.equal(sanitizeCustomerName('Customer'), '')
  assert.equal(sanitizeCustomerName('Rahul Sharma'), 'Rahul Sharma')
})

test('ARI and customer Indian number formats normalize to one identity', () => {
  for (const phone of ['919166623128', '+919166623128', '9166623128', '00919166623128', '+91 91666 23128', 'PJSIP/+919166623128@vobiz', 'SIP/919166623128@carrier']) {
    assert.equal(normalizeCustomerPhone(phone), '+919166623128')
  }
  for (const phone of ['unknown', '{{initial_context.caller_number}}', '8000', '+910000000000']) assert.equal(normalizeCustomerPhone(phone), null)
})

test('resolveCustomerPhone never books appointments under agent outbound CLI number', () => {
  const agentCli = '+917955853365'
  const customerNumber = '+919166623128'

  // Outbound calls must prioritize crmPhone or calledNumber and NEVER use agent CLI
  assert.equal(resolveCustomerPhone({ direction: 'outbound', phone: agentCli, crmPhone: customerNumber }), customerNumber)
  assert.equal(resolveCustomerPhone({ direction: 'OUTBOUND', phone: agentCli, crmPhone: '9166623128' }), customerNumber)
  assert.equal(resolveCustomerPhone({ direction: 'outbound', phone: agentCli, calledNumber: 'PJSIP/+919166623128@vobiz' }), customerNumber)
  assert.equal(resolveCustomerPhone({ phone: agentCli, crmPhone: customerNumber }), customerNumber)

  // Inbound calls use caller ID (phone)
  assert.equal(resolveCustomerPhone({ direction: 'inbound', phone: customerNumber, crmPhone: undefined }), customerNumber)
  assert.equal(resolveCustomerPhone({ direction: 'inbound', phone: 'unknown', providedPhone: customerNumber }), customerNumber)

  // Explicitly provided number fallback
  assert.equal(resolveCustomerPhone({ direction: 'outbound', phone: agentCli, crmPhone: 'unknown', providedPhone: customerNumber }), customerNumber)
})

test('relative dates use India clock and reject past dates', () => {
  assert.equal(resolveAppointmentDate(undefined, 'कल', '2026-09-13'), '2026-09-14')
  assert.equal(resolveAppointmentDate('2025-01-01', 'tomorrow', '2026-12-31'), '2027-01-01')
  assert.equal(resolveAppointmentDate(undefined, 'day after tomorrow', '2026-09-13'), '2026-09-15')
  assert.equal(resolveAppointmentDate(undefined, 'परसों', '2026-09-13'), '2026-09-15')
  assert.equal(resolveAppointmentDate('2026-09-14', 'बीते कल', '2026-09-13'), null)
  assert.equal(resolveAppointmentDate(undefined, '2026-09-14', '2026-09-13'), '2026-09-14')
  assert.equal(resolveAppointmentDate('2026-02-30', '', '2026-01-01'), null)
  assert.equal(resolveAppointmentDate('2026-09-12', '', '2026-09-13'), null)
})

test('Sunday stays closed and same-day past slots are rejected in IST', () => {
  assert.equal(isSundayAppointmentDate('2026-09-13'), true)
  assert.equal(nextOpenAppointmentDate('2026-09-12'), '2026-09-14')
  const now = new Date('2026-09-14T06:00:00Z') // 11:30 AM India
  assert.equal(isPastAppointmentSlot('2026-09-14', '11:00 AM', now), true)
  assert.equal(isPastAppointmentSlot('2026-09-14', '12:00 PM', now), false)
  assert.equal(normalizeAppointmentTime('14:00'), '2:00 PM')
  assert.equal(normalizeAppointmentTime('1:00 PM'), null)
})
