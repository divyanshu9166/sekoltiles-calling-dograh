import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as schedule from '../lib/campaigns/schedule.mjs'

function harness(file, initial = {}, authorized = true) {
  let campaign = { id: 1, name: 'Test campaign', instructions: 'Keep the existing script.', interCallDelaySec: 15,
    status: 'DRAFT', callingStartTime: null, callingEndTime: null, autoResumeDaily: false,
    scheduleStopAt: null, _count: { leads: 2 }, ...initial }
  const writes = []
  const prisma = {
    marketingCampaign: {
      findUnique: async () => campaign,
      update: async ({ data }) => { writes.push(data); campaign = { ...campaign, ...data }; return campaign },
      create: async ({ data }) => { writes.push(data); return { ...campaign, ...data } },
    },
  }
  const require = id => {
    if (id === 'next/server') return { NextResponse: Response }
    if (id === '@/lib/db') return { prisma }
    if (id === '@/lib/auth') return { getCurrentAdmin: async () => authorized }
    if (id === '@/lib/campaigns/schedule.mjs') return schedule
    if (id === '@/lib/campaigns/import') return { importGoogleSheet: async () => ({ leads: [{ name: 'Test', phone: '+911234567890' }] }) }
    throw new Error(`Unexpected import ${id}`)
  }
  const source = readFileSync(new URL(`../app/api/campaigns/${file}`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', compiled)(require, module, module.exports)
  return { ...module.exports, writes }
}
const context = { params: Promise.resolve({ id: '1' }) }
const patchBody = { name: 'Test campaign', instructions: 'Keep the existing script.', interCallDelaySec: 15 }
const request = (body, method = 'PATCH') => new Request('https://test.invalid/api/campaigns/1', {
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

test('PATCH saves custom hours and automatic resume', async () => {
  const api = harness('[id]/route.ts')
  const response = await api.PATCH(request({ ...patchBody, callingStartTime: '09:30', callingEndTime: '16:45', autoResumeDaily: true }), context)
  assert.equal(response.status, 200)
  assert.equal(api.writes[0].callingStartTime, '09:30')
  assert.equal(api.writes[0].callingEndTime, '16:45')
  assert.equal(api.writes[0].autoResumeDaily, true)
  assert.equal(api.writes[0].instructions, patchBody.instructions)
})

test('PATCH rejects invalid times before any DB update', async () => {
  for (const changes of [{ callingStartTime: '17:00', callingEndTime: '10:00' }, { callingStartTime: '10:00' }, { autoResumeDaily: 'false' }]) {
    const api = harness('[id]/route.ts')
    assert.equal((await api.PATCH(request({ ...patchBody, ...changes }), context)).status, 400)
    assert.equal(api.writes.length, 0)
  }
})

test('instructions-only update preserves running manual deadline; disabling clears it', async () => {
  const initial = { status: 'RUNNING', callingStartTime: '10:00', callingEndTime: '17:00', scheduleStopAt: new Date('2026-10-09T11:30:00Z') }
  const api = harness('[id]/route.ts', initial)
  await api.PATCH(request(patchBody), context)
  assert.equal(Object.hasOwn(api.writes[0], 'scheduleStopAt'), false)
  assert.equal(api.writes[0].callingStartTime, '10:00')
  await api.PATCH(request({ ...patchBody, callingStartTime: null, callingEndTime: null, autoResumeDaily: false }), context)
  assert.equal(api.writes[1].scheduleStopAt, null)
})

test('Resume arms manual deadline; explicit Pause keeps automatic campaign stopped', async () => {
  const api = harness('[id]/control/route.ts', { status: 'PAUSED', callingStartTime: '10:00', callingEndTime: '17:00' })
  assert.equal((await api.POST(request({ action: 'resume' }, 'POST'), context)).status, 200)
  assert.equal(api.writes[0].status, 'RUNNING')
  assert.ok(api.writes[0].scheduleStopAt instanceof Date)
  assert.ok(api.writes[0].nextCallAt instanceof Date)
  const auto = harness('[id]/control/route.ts', { status: 'RUNNING', autoResumeDaily: true })
  await auto.POST(request({ action: 'pause' }, 'POST'), context)
  assert.equal(auto.writes[0].status, 'PAUSED')
})

test('create accepts the form schedule and older clients remain unscheduled', async () => {
  for (const enabled of [true, false]) {
    const api = harness('route.ts')
    const form = new FormData()
    for (const [key, value] of Object.entries({ ...patchBody, googleSheetUrl: 'https://docs.google.com/spreadsheets/d/test' })) form.set(key, String(value))
    if (enabled) {
      form.set('callingStartTime', '10:00'); form.set('callingEndTime', '17:00'); form.set('autoResumeDaily', 'true')
    }
    assert.equal((await api.POST(new Request('https://test.invalid/api/campaigns', { method: 'POST', body: form }))).status, 200)
    assert.equal(api.writes[0].callingStartTime, enabled ? '10:00' : null)
    assert.equal(api.writes[0].autoResumeDaily, enabled)
  }
})

test('unauthenticated callers cannot edit or start schedules', async () => {
  const api = harness('[id]/route.ts', {}, false)
  assert.equal((await api.PATCH(request(patchBody), context)).status, 401)
  assert.equal(api.writes.length, 0)
  const control = harness('[id]/control/route.ts', {}, false)
  assert.equal((await control.POST(request({ action: 'resume' }, 'POST'), context)).status, 401)
})
