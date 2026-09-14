import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as booking from '../lib/appointments/booking.ts'

test('lookup scopes query to caller and active future bookings; never treats an error as no booking', async () => {
  const previous = process.env.CRM_API_SECRET
  process.env.CRM_API_SECRET = 'test-only'
  let query
  let fail = false
  const module = { exports: {} }
  const code = ts.transpileModule(readFileSync(new URL('../app/api/appointments/existing/route.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const require = id => {
    if (id === 'next/server') return { NextResponse: Response }
    if (id === '@/lib/appointments/booking') return {
      ...booking, indiaDateString: () => '2026-09-14',
      isPastAppointmentSlot: (date, time) => booking.isPastAppointmentSlot(date, time, new Date('2026-09-14T06:00:00Z')),
    }
    if (id === '@/lib/db') return { prisma: { appointment: { findMany: async args => {
      if (fail) throw new Error('DB unavailable')
      query = args
      return [{ id: 1, date: new Date('2026-09-14'), time: '10:00 AM' }, { id: 2, date: new Date('2026-09-14'), time: '2:00 PM' }]
    } } } }
    throw new Error(id)
  }
  new Function('require', 'module', 'exports', code)(require, module, module.exports)
  const request = (secret = 'test-only', phone = '919166623128') => new Request('https://crm.invalid', { method: 'POST', headers: { 'x-api-secret': secret }, body: JSON.stringify({ crmPhone: phone }) })
  try {
    assert.equal((await module.exports.POST(request('wrong'))).status, 401)
    const result = await (await module.exports.POST(request())).json()
    assert.equal(query.where.contact.phone, '+919166623128')
    assert.equal(query.where.status, 'Scheduled')
    assert.equal(query.take, 10)
    assert.deepEqual(query.select, { id: true, date: true, time: true })
    assert.equal(result.hasAppointment, true)
    assert.deepEqual(result.appointments.map(a => a.id), [2])
    const invalid = await (await module.exports.POST(request('test-only', 'unknown'))).json()
    assert.equal(invalid.code, 'INVALID_PHONE')
    fail = true
    const unavailable = await (await module.exports.POST(request())).json()
    assert.equal(unavailable.code, 'LOOKUP_UNAVAILABLE')
    assert.equal(unavailable.hasAppointment, undefined)
  } finally {
    if (previous === undefined) delete process.env.CRM_API_SECRET
    else process.env.CRM_API_SECRET = previous
  }
})
