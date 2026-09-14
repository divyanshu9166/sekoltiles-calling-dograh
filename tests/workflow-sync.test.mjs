import test from 'node:test'
import assert from 'node:assert/strict'

test('sync publishes calendar and booking recovery without replacing chosen models or telephony', async () => {
  const savedEnv = { ...process.env }
  const originalFetch = globalThis.fetch
  Object.assign(process.env, {
    DOGRAH_API_URL: 'https://dograh.invalid', DOGRAH_API_KEY: 'test', DOGRAH_WORKFLOW_UUID: 'workflow-test',
    CRM_API_SECRET: 'test-secret', CRM_PUBLIC_URL: 'https://crm.invalid', DOGRAH_TELEPHONY_PROVIDER: 'ari',
    DOGRAH_ARI_TRUNK_ENDPOINT: 'vobiz', CALL_TRANSFER_NUMBER: '+919694716263',
  })
  const tools = []
  let published = false
  let update
  const models = { llm: 'selected-model', stt: 'selected-stt', tts: 'selected-tts' }
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname.replace('/api/v1', '')
    const payload = init.body ? JSON.parse(init.body) : null
    let result
    if (path === '/credentials/') result = init.method === 'POST' ? { uuid: 'credential' } : []
    else if (path === '/tools/') {
      if (init.method === 'POST') { tools.push(payload); result = { tool_uuid: payload.name } }
      else result = []
    } else if (path === '/workflow/fetch') result = [{ id: 1, workflow_uuid: 'workflow-test' }]
    else if (path === '/workflow/fetch/1') result = { name: 'Anushka', workflow_definition: {}, workflow_configurations: { models, telephony_configuration_id: 3 } }
    else if (path === '/workflow/1') { update = payload; result = {} }
    else if (path === '/workflow/1/validate') result = { valid: true }
    else if (path === '/workflow/1/publish') { published = true; result = {} }
    else throw new Error(`Unexpected request: ${path}`)
    return new Response(JSON.stringify(result), { status: 200 })
  }
  try {
    await import('../scripts/sync-dograh-workflow.mjs')
    assert.equal(published, true)
    assert.deepEqual(update.workflow_configurations.models, models)
    assert.equal(update.workflow_configurations.telephony_configuration_id, 3)
    const start = update.workflow_definition.nodes.find(n => n.type === 'startCall')
    assert.ok(start.data.tool_uuids.includes('get_booking_calendar'))
    assert.ok(start.data.tool_uuids.includes('check_inbound_appointments'))
    assert.ok(start.data.tool_uuids.includes('check_outbound_appointments'))
    assert.ok(start.data.tool_uuids.includes('transfer_to_human'))
    assert.match(start.data.prompt, /NEXT missing detail/)
    const inbound = tools.find(t => t.name === 'book_inbound_appointment').definition.config
    assert.equal(inbound.preset_parameters.find(p => p.name === 'phone').required, false)
    assert.equal(inbound.parameters.find(p => p.name === 'date').required, false)
    assert.ok(inbound.parameters.some(p => p.name === 'fallbackPhone'))
    assert.equal(tools.find(t => t.name === 'transfer_to_human').definition.config.destination, 'PJSIP/+919694716263@vobiz')
  } finally {
    globalThis.fetch = originalFetch
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key]
    Object.assign(process.env, savedEnv)
  }
})
