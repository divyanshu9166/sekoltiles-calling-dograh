import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

test('compact customer action dispatches only authenticated supported actions', async () => {
  const previous = process.env.CRM_API_SECRET
  process.env.CRM_API_SECRET = 'test-only'
  const calls = []
  const responder = name => async req => {
    calls.push({ name, body: await req.json() })
    return Response.json({ success: true, name })
  }
  const source = readFileSync(new URL('../app/api/agent/action/route.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const module = { exports: {} }
  const require = id => {
    if (id === 'next/server') return { NextRequest: Request, NextResponse: Response }
    if (id.includes('/appointments/existing/')) return { POST: responder('check') }
    if (id.includes('/appointments/create/')) return { POST: responder('book') }
    if (id.includes('/calls/schedule-callback/')) return { POST: responder('callback') }
    if (id.includes('/calling-agent/customer-action-guard.mjs')) return { isCatalogueMisroutedToAppointment: () => false }
    throw new Error(`Unexpected import ${id}`)
  }
  new Function('require', 'module', 'exports', compiled)(require, module, module.exports)
  const request = (action, secret = 'test-only') => new Request('https://crm.invalid/api/agent/action', {
    method: 'POST', headers: { 'x-api-secret': secret, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, crmName: 'Rahul' }),
  })
  try {
    assert.equal((await module.exports.POST(request('check', 'wrong'))).status, 401)
    assert.equal((await module.exports.POST(request('unsupported'))).status, 400)
    for (const action of ['check', 'book', 'callback']) {
      const result = await (await module.exports.POST(request(action))).json()
      assert.equal(result.name, action)
    }
    assert.deepEqual(calls.map(call => call.name), ['check', 'book', 'callback'])
    assert.equal(calls[1].body.crmName, 'Rahul')
  } finally {
    if (previous === undefined) delete process.env.CRM_API_SECRET
    else process.env.CRM_API_SECRET = previous
  }
})
