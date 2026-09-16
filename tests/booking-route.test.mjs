import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as booking from '../lib/appointments/booking.ts'

// Execute the actual handler with a deterministic clock and an isolated DB stub.
// No application .env, network request or production database is used.
function handler() {
  const appointments = []
  let transactions = 0
  const tx = {
    $executeRaw: async () => {},
    appointment: {
      findMany: async () => appointments,
      create: async ({ data }) => {
        const row = { ...data, id: appointments.length + 1, contact: { phone: '+919166623128' } }
        appointments.push(row)
        return row
      },
      update: async ({ where, data }) => {
        const index = appointments.findIndex(a => a.id === where.id)
        if (index !== -1) {
          appointments[index] = { ...appointments[index], ...data }
          return appointments[index]
        }
        return data
      },
    },
    contact: { upsert: async () => ({ id: 1 }) },
  }
  const prisma = {
    appointment: {
      findFirst: async ({ where }) => {
        const phone = where?.contact?.phone
        return appointments.find(a => a.contact?.phone === phone && a.status === 'Scheduled') || null
      },
    },
    $transaction: async fn => { transactions++; return fn(tx) },
  }
  const source = readFileSync(new URL('../app/api/appointments/create/route.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const module = { exports: {} }
  const require = id => {
    if (id === 'next/server') return { NextResponse: Response }
    if (id === '@/lib/db') return { prisma }
    if (id === '@/lib/appointments/booking') return {
      ...booking,
      indiaDateString: () => '2026-09-13',
      isPastAppointmentSlot: (date, time) => booking.isPastAppointmentSlot(date, time, new Date('2026-09-13T06:00:00Z')),
    }
    throw new Error(`Unexpected import ${id}`)
  }
  new Function('require', 'module', 'exports', compiled)(require, module, module.exports)
  return { post: module.exports.POST, appointments, count: () => transactions }
}

test('booking handler accepts ARI caller ID and recovers committed retry without duplicate', async () => {
  const previous = process.env.CRM_API_SECRET
  process.env.CRM_API_SECRET = 'test-only'
  try {
    const { post, appointments, count } = handler()
    const body = { crmName: 'Rahul', crmPhone: '919166623128', spokenDate: 'कल', time: '14:00' }
    const request = data => new Request('https://crm.invalid/api/appointments/create', {
      method: 'POST', headers: { 'x-api-secret': 'test-only', 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    })
    const first = await (await post(request(body))).json()
    const retry = await (await post(request(body))).json()
    assert.equal(first.success, true)
    assert.equal(first.data.date, '2026-09-14')
    assert.equal(retry.data.id, first.data.id)
    assert.equal(appointments.length, 1)
    // Idempotent check for the exact same slot returns success with alreadyBooked: true
    const sameSlot = await (await post(request(body))).json()
    assert.equal(sameSlot.success, true)
    assert.equal(sameSlot.alreadyBooked, true)
    assert.equal(appointments.length, 1)
    const sunday = await (await post(request({ ...body, spokenDate: 'आज' }))).json()
    assert.equal(sunday.code, 'SUNDAY_CLOSED')
    const invalid = await (await post(request({ ...body, crmPhone: 'unknown' }))).json()
    assert.equal(invalid.code, 'INVALID_PHONE')
    // Requesting a different slot automatically reschedules the existing appointment
    const rescheduled = await (await post(request({ ...body, time: '3:00 PM' }))).json()
    assert.equal(rescheduled.success, true)
    assert.equal(rescheduled.rescheduled, true)
    assert.equal(rescheduled.data.time, '3:00 PM')
    assert.equal(appointments.length, 1)
    assert.equal(appointments[0].time, '3:00 PM')
    assert.equal(count(), 2)
  } finally {
    if (previous === undefined) delete process.env.CRM_API_SECRET
    else process.env.CRM_API_SECRET = previous
  }
})
