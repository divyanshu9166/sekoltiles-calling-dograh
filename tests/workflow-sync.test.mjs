import test from 'node:test'
import assert from 'node:assert/strict'

test('sync publishes compact customer tools without replacing chosen models or telephony', async () => {
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
    assert.ok(start.data.tool_uuids.includes('customer_action'))
    assert.ok(start.data.tool_uuids.includes('transfer_to_human'))
    assert.ok(start.data.tool_uuids.includes('end_call'))
    assert.equal(start.data.tool_uuids.length, 3)
    assert.match(start.data.prompt, /NEXT missing detail/)
    assert.match(start.data.prompt, /helpful Indian sales executive/)
    assert.match(start.data.prompt, /If one reply supplies several details/)
    assert.match(start.data.prompt, /Never leave a conversational dead end/)
    assert.match(start.data.prompt, /FIRST booking\/check request/)
    assert.match(start.data.prompt, /Sunday is closed/)
    assert.match(start.data.prompt, /Odisha\/West Bengal/)
    assert.match(start.data.prompt, /Rajasthan: 12x18 = ₹165; 12x24 = ₹210/)
    assert.match(start.data.prompt, /Delhi\/Punjab\/Haryana: 12x18 = ₹160; 12x24 = ₹200/)
    assert.match(start.data.prompt, /SPOKEN SIZE RULE \(strict\)/)
    assert.match(start.data.prompt, /selected CRM lead zone/)
    assert.match(start.data.prompt, /introduce BOTH sizes first/)
    assert.match(start.data.prompt, /sales campaign is not automatically an offer/)
    assert.match(start.data.prompt, /otherwise ask region before price/)
    assert.match(start.data.prompt, /If hasAppointment=true/)
    assert.match(start.data.prompt, /Outbound never asks known name\/phone\/region/)
    assert.match(start.data.prompt, /campaign_rules/)
    assert.match(start.data.prompt, /call end_call immediately/)
    assert.match(start.data.prompt, /immediately call transfer_to_human/)
    assert.match(start.data.prompt, /CATALOGUE FOLLOW-UP/)
    assert.match(start.data.prompt, /मैंने आपकी कैटलॉग रिक्वेस्ट नोट कर ली है/)
    assert.ok(start.data.prompt.length < 7_200, `prompt is ${start.data.prompt.length} chars`)
    assert.ok(JSON.stringify(tools).length < 9_000, 'attached tool schemas must remain compact')
    const booking = tools.find(t => t.name === 'customer_action').definition.config
    assert.equal(booking.preset_parameters.find(p => p.name === 'phone').required, false)
    assert.equal(booking.parameters.find(p => p.name === 'date').required, false)
    assert.ok(booking.parameters.some(p => p.name === 'providedPhone'))
    assert.equal(tools.find(t => t.name === 'transfer_to_human').definition.config.destination, 'PJSIP/+919694716263@vobiz')
    const webhook = update.workflow_definition.nodes.find(n => n.type === 'webhook')
    assert.equal(webhook.data.endpoint_url, 'https://crm.invalid/api/calls/dograh-webhook')
  } finally {
    globalThis.fetch = originalFetch
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key]
    Object.assign(process.env, savedEnv)
  }
})
