import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const priorSecret = process.env.SEKOL_ALERT_SECRET
before(() => { process.env.SEKOL_ALERT_SECRET = 'test-event-secret' })
after(() => { if (priorSecret === undefined) delete process.env.SEKOL_ALERT_SECRET; else process.env.SEKOL_ALERT_SECRET = priorSecret })

function handler({ authorized = true, configured = true, changed = false } = {}) {
  const now = new Date('2026-10-15T13:02:00Z')
  const writes = []
  const alert = { id: 1, status: 'OPEN', severity: 'CRITICAL', service: 'sarvam', lastSeenAt: now, events: [{ id: 4, runId: '5463', observedAt: now }] }
  const prisma = {
    serviceAlert: {
      findMany: async ({ where }) => where.status === 'RESOLVED' ? [] : [alert],
      updateMany: async args => { writes.push(args); return { count: changed ? 0 : 1 } },
    },
    serviceMonitorState: { findUnique: async () => ({ heartbeatAt: now, details: { mode: 'EVENT_DRIVEN', enabled: configured, lastEventAt: now.toISOString() } }) },
    callLog: { findMany: async () => [{ id: 12, dograhRunId: '5463', customerName: 'Test caller', direction: 'INBOUND' }] },
  }
  const compiled = ts.transpileModule(readFileSync(new URL('../app/api/service-alerts/route.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  new Function('require', 'exports', 'module', compiled)(id => {
    if (id === 'next/server') return { NextResponse: Response }
    if (id === '@/lib/auth') return { getCurrentAdmin: async () => authorized }
    if (id === '@/lib/db') return { prisma }
    if (id === '@/lib/service-alerts/events') return { publishServiceAlert: () => {} }
    throw new Error('Unexpected import')
  }, module.exports, module)
  return { ...module.exports, writes }
}
const patch = body => new Request('https://test.invalid/api/service-alerts', { method: 'PATCH', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })

test('both notification reads and state changes require an authenticated admin', async () => {
  const api = handler({ authorized: false })
  assert.equal((await api.GET()).status, 401)
  assert.equal((await api.PATCH(patch({ id: 1, action: 'resolve' }))).status, 401)
  assert.equal(api.writes.length, 0)
})
test('event-driven status stays configured without heartbeat writes or provider checks', async () => {
  const response = await handler().GET()
  const data = await response.json()
  assert.equal(data.activeCount, 1)
  assert.equal(data.criticalCount, 1)
  assert.equal(data.monitor.online, true)
  assert.equal(data.alerts[0].events[0].call.id, 12)
  assert.match(response.headers.get('Cache-Control'), /no-store/)
  assert.equal(data.monitor.mode, 'EVENT_DRIVEN')
  const unconfigured = await (await handler({ configured: false }).GET()).json()
  assert.equal(unconfigured.monitor.online, false)
})
test('acknowledge/resolve are guarded by the observed failure timestamp', async () => {
  const api = handler()
  assert.equal((await api.PATCH(patch({ id: 1, action: 'resolve', lastSeenAt: '2026-10-15T13:02:00Z' }))).status, 200)
  assert.equal(api.writes[0].where.lastSeenAt.toISOString(), '2026-10-15T13:02:00.000Z')
  assert.equal(api.writes[0].data.status, 'RESOLVED')
  const raced = handler({ changed: true })
  assert.equal((await raced.PATCH(patch({ id: 1, action: 'resolve', lastSeenAt: '2026-10-15T13:02:00Z' }))).status, 409)
  assert.equal((await api.PATCH(patch({ id: 1, action: 'delete' }))).status, 400)
  assert.equal((await api.PATCH(patch({ id: 1, action: 'resolve', lastSeenAt: 'bad-date' }))).status, 400)
})
