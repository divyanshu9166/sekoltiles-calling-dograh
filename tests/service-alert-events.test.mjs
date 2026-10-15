import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as crypto from 'node:crypto'
import * as classifier from '../lib/service-alerts/classify.mjs'

const priorSecret = process.env.SEKOL_ALERT_SECRET
before(() => { process.env.SEKOL_ALERT_SECRET = 'event-test-secret' })
after(() => { if (priorSecret === undefined) delete process.env.SEKOL_ALERT_SECRET; else process.env.SEKOL_ALERT_SECRET = priorSecret })

function handler() {
  const events = []; const broadcasts = []
  const prisma = { serviceMonitorState: { upsert: async () => {} } }
  const source = readFileSync(new URL('../app/api/service-alerts/events/route.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', compiled)(id => {
    if (id === 'next/server') return { NextResponse: Response }
    if (id === 'node:crypto') return crypto
    if (id === '@/lib/db') return { prisma }
    if (id === '@/lib/service-alerts/classify.mjs') return classifier
    if (id === '@/lib/service-alerts/store.mjs') return { recordServiceFailure: async (_, e) => { events.push(e) } }
    if (id === '@/lib/service-alerts/events') return { publishServiceAlert: () => broadcasts.push(true) }
    throw new Error('Unexpected import ' + id)
  }, module, module.exports)
  return { ...module.exports, events, broadcasts }
}

const body = () => ({ source: 'stt', provider: 'sarvam', code: 'sarvam-connection', message: 'Credits exhausted', runId: '5463', timestamp: new Date().toISOString() })
const request = (data, secret = 'event-test-secret') => new Request('https://crm.invalid/api/service-alerts/events', { method: 'POST', headers: { 'x-sekol-alert-secret': secret }, body: JSON.stringify(data) })

test('a real authenticated failure is saved and broadcasts a dashboard update', async () => {
  const api = handler()
  assert.equal((await api.POST(request(body()))).status, 200)
  assert.equal(api.events.length, 1)
  assert.equal(api.events[0].service, 'sarvam')
  assert.equal(api.events[0].component, 'STT')
  assert.equal(api.events[0].code, 'CREDITS_EXHAUSTED')
  assert.equal(api.broadcasts.length, 1)
})

test('missing credentials, old events, invalid sources and oversized input cannot create alerts', async () => {
  const api = handler()
  assert.equal((await api.POST(request(body(), 'wrong-secret'))).status, 401)
  assert.equal((await api.POST(request({ ...body(), timestamp: '2020-01-01T00:00:00Z' }))).status, 400)
  assert.equal((await api.POST(request({ ...body(), source: 'user-chat' }))).status, 400)
  assert.equal((await api.POST(request({ ...body(), message: 'x'.repeat(20000) }))).status, 413)
  assert.equal(api.events.length, 0)
  assert.equal(api.broadcasts.length, 0)
})
