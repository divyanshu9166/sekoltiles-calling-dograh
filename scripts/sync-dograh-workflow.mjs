import { buildSekolDograhPrompt, DEFAULT_HUMAN_HANDOFF_NUMBER } from '../lib/calling-agent/prompt.mjs'
import pg from 'pg'

const rawBase = process.env.DOGRAH_API_URL?.trim().replace(/\/+$/, '')
const apiKey = process.env.DOGRAH_API_KEY?.trim()
const workflowUuid = process.env.DOGRAH_WORKFLOW_UUID?.trim()
const crmSecret = process.env.CRM_API_SECRET?.trim()
const crmPublicUrl = (process.env.CRM_PUBLIC_URL || '').trim().replace(/\/+$/, '')
const explicitHandoffNumber = process.env.CALL_TRANSFER_NUMBER?.trim()
const isAriTelephony = process.env.DOGRAH_TELEPHONY_PROVIDER?.trim().toLowerCase() === 'ari'
const ariTrunkEndpoint = process.env.DOGRAH_ARI_TRUNK_ENDPOINT?.trim()

async function savedTransferNumber() {
  if (!process.env.DATABASE_URL) return null
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 2_000 })
  try {
    await client.connect()
    const result = await client.query('SELECT "transferPhone" FROM "AdminUser" ORDER BY "id" ASC LIMIT 1')
    return typeof result.rows[0]?.transferPhone === 'string' ? result.rows[0].transferPhone.trim() : null
  } catch (error) {
    console.warn('Could not load the dashboard transfer number; using CALL_TRANSFER_NUMBER fallback.', error.message)
    return null
  } finally {
    await client.end().catch(() => {})
  }
}

for (const [name, value] of Object.entries({
  DOGRAH_API_URL: rawBase,
  DOGRAH_API_KEY: apiKey,
  DOGRAH_WORKFLOW_UUID: workflowUuid,
  CRM_API_SECRET: crmSecret,
  CRM_PUBLIC_URL: crmPublicUrl,
})) {
  if (!value) throw new Error(`${name} is required`)
}

const apiBase = rawBase.endsWith('/api/v1') ? rawBase : `${rawBase}/api/v1`
const headers = { 'Content-Type': 'application/json', 'X-API-Key': apiKey }

async function api(path, init = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: { ...headers, ...init.headers },
    signal: AbortSignal.timeout(20_000),
  })
  const text = await response.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  if (!response.ok) throw new Error(`${init.method || 'GET'} ${path} failed (${response.status}): ${typeof body === 'string' ? body : JSON.stringify(body)}`)
  return body
}

async function upsertCredential() {
  const name = 'Sekol CRM API Secret'
  const credentials = await api('/credentials/')
  const existing = credentials.find((item) => item.name === name)
  const payload = {
    name,
    description: 'Authenticates Dograh appointment and post-call requests to the isolated Sekol calling CRM.',
    credential_type: 'custom_header',
    credential_data: { header_name: 'x-api-secret', header_value: crmSecret },
  }
  if (existing) {
    await api(`/credentials/${existing.uuid}`, { method: 'PUT', body: JSON.stringify(payload) })
    return existing.uuid
  }
  return (await api('/credentials/', { method: 'POST', body: JSON.stringify(payload) })).uuid
}

async function upsertTool(payload) {
  const tools = await api('/tools/')
  const existing = tools.find((item) => item.name === payload.name && item.status !== 'archived')
  if (existing) {
    const { category: _category, ...update } = payload
    const saved = await api(`/tools/${existing.tool_uuid}`, { method: 'PUT', body: JSON.stringify({ ...update, status: 'active' }) })
    return saved.tool_uuid
  }
  return (await api('/tools/', { method: 'POST', body: JSON.stringify(payload) })).tool_uuid
}

function stringParameter(name, description, required = true) {
  return { name, type: 'string', description, required }
}

const credentialUuid = await upsertCredential()

const trustedContextPresets = [
  { name: 'direction', type: 'string', value_template: '{{initial_context.direction}}', required: false },
  { name: 'phone', type: 'string', value_template: '{{initial_context.caller_number}}', required: false },
  { name: 'crmPhone', type: 'string', value_template: '{{initial_context.phone_number}}', required: false },
  { name: 'calledNumber', type: 'string', value_template: '{{initial_context.called_number}}', required: false },
  { name: 'crmName', type: 'string', value_template: '{{initial_context.customer_name}}', required: false },
  { name: 'crmRegion', type: 'string', value_template: '{{initial_context.region}}', required: false },
]

const customerActionUuid = await upsertTool({
  name: 'customer_action',
  description: 'Check/book appointments or record an agreed callback.',
  category: 'http_api', icon: 'phone-forwarded', icon_color: '#2563EB',
  definition: { schema_version: 1, type: 'http_api', config: {
    method: 'POST', url: `${crmPublicUrl}/api/agent/action`, credential_uuid: credentialUuid,
    parameters: [
      stringParameter('action', 'check, book, reschedule, or callback'),
      stringParameter('customerName', 'Name if CRM has none.', false),
      stringParameter('providedPhone', 'Phone if context has none.', false),
      stringParameter('calledNumber', 'Called number from context.', false),
      stringParameter('spokenDate', 'Booking date as spoken.', false),
      stringParameter('date', 'Booking date YYYY-MM-DD if known.', false),
      stringParameter('time', 'Booking time.', false),
      stringParameter('purpose', 'Booking purpose.', false),
      stringParameter('region', 'Region if CRM has none.', false),
      stringParameter('preferredTime', 'Callback time.', false),
      stringParameter('reason', 'Callback reason.', false),
      stringParameter('reschedule', 'Set true if rescheduling existing appointment.', false),
    ],
    preset_parameters: trustedContextPresets, timeout_ms: 5000,
  } },
})

const endCallUuid = await upsertTool({
  name: 'end_call',
  description: 'End the telephone call immediately when the purpose is complete, the customer declines, asks to disconnect, or says goodbye. Do not keep talking after using it.',
  category: 'end_call',
  icon: 'phone-off',
  icon_color: '#DC2626',
  definition: {
    schema_version: 1,
    type: 'end_call',
    config: {
      messageType: 'custom',
      customMessage: 'आपके समय के लिए धन्यवाद। नमस्ते!',
      endCallReason: true,
      endCallReasonDescription: 'Short reason such as purpose_completed, customer_declined, callback_requested, or customer_requested_disconnect.',
    },
  },
})

const workflows = await api('/workflow/fetch')
const workflow = workflows.find((item) => (item.workflow_uuid || item.uuid) === workflowUuid)
if (!workflow) throw new Error(`Workflow UUID ${workflowUuid} was not found`)

const current = await api(`/workflow/fetch/${workflow.id}`)
const existingPrompt = current.workflow_definition?.nodes?.find((node) => node.type === 'startCall')?.data?.prompt || ''
const promptHandoffNumber = existingPrompt.match(/configured human handoff number\s+(\+[0-9 ()-]{7,})/i)?.[1]
const dashboardHandoffNumber = await savedTransferNumber()
const humanHandoffNumber = (dashboardHandoffNumber || explicitHandoffNumber || promptHandoffNumber || DEFAULT_HUMAN_HANDOFF_NUMBER).replace(/[\s().-]/g, '')
if (!/^\+[1-9]\d{7,14}$/.test(humanHandoffNumber)) {
  throw new Error('CALL_TRANSFER_NUMBER must be a valid E.164 number such as +919726418181')
}
if (isAriTelephony && !ariTrunkEndpoint) {
  throw new Error('DOGRAH_ARI_TRUNK_ENDPOINT is required when DOGRAH_TELEPHONY_PROVIDER=ari')
}
if (ariTrunkEndpoint && !/^[A-Za-z0-9_.-]+$/.test(ariTrunkEndpoint)) {
  throw new Error('DOGRAH_ARI_TRUNK_ENDPOINT is invalid')
}

const liveTransferUuid = isAriTelephony
  ? await upsertTool({
      name: 'transfer_to_human',
      description: 'Immediately bridge a caller to the configured Sekol human team member after an explicit human-agent or call-transfer request.',
      category: 'transfer_call',
      icon: 'phone-forwarded',
      icon_color: '#2563EB',
      definition: {
        schema_version: 1,
        type: 'transfer_call',
        config: {
          destination_source: 'static',
          destination: `PJSIP/${humanHandoffNumber}@${ariTrunkEndpoint}`,
          messageType: 'custom',
          customMessage: 'एक क्षण, मैं आपको हमारी टीम से जोड़ रही हूँ।',
          timeout: 30,
          call_disposition: 'transferred_to_human',
        },
      },
    })
  : null
const definition = {
  nodes: [
    {
      id: 'sekol-start',
      type: 'startCall',
      position: { x: 160, y: 100 },
      data: {
        name: 'Sekol Tiles - Anushka',
        prompt: buildSekolDograhPrompt(humanHandoffNumber, { liveTransferEnabled: isAriTelephony }),
        greeting_type: 'text',
        greeting: 'नमस्ते! Sekol Tiles में आपका स्वागत है, मैं अनुष्का AI सहायक बोल रही हूँ। कैसे मदद करूँ?',
        allow_interrupt: true,
        add_global_prompt: false,
        delayed_start: false,
        extraction_enabled: false,
        tool_uuids: [
          customerActionUuid,
          ...(liveTransferUuid ? [liveTransferUuid] : []),
          endCallUuid,
        ],
        is_start: true,
      },
    },
    {
      id: 'sekol-post-call-webhook',
      type: 'webhook',
      position: { x: 560, y: 100 },
      data: {
        name: 'Sync completed call to Sekol CRM',
        enabled: true,
        http_method: 'POST',
        endpoint_url: `${crmPublicUrl}/api/calls/dograh-webhook`,
        credential_uuid: credentialUuid,
        payload_template: {
          workflow_run_id: '{{workflow_run_id}}',
          crm_call_log_id: '{{initial_context.crm_call_log_id}}',
          initial_context: '{{initial_context}}',
          gathered_context: '{{gathered_context}}',
          duration_seconds: '{{cost_info.call_duration_seconds}}',
          recording_url: '{{recording_url}}',
          transcript_url: '{{transcript_url}}',
          call_disposition: '{{gathered_context.call_disposition}}',
        },
      },
    },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
}

await api(`/workflow/${workflow.id}`, {
  method: 'PUT',
  body: JSON.stringify({
    name: current.name || 'Sekol Tiles - Anushka',
    workflow_definition: definition,
    template_context_variables: current.template_context_variables || {},
    workflow_configurations: {
      ...(current.workflow_configurations || {}),
      max_call_duration: Math.min(current.workflow_configurations?.max_call_duration || 300, 300),
      max_user_idle_timeout: current.workflow_configurations?.max_user_idle_timeout || 10,
    },
  }),
})

const validation = await api(`/workflow/${workflow.id}/validate`, { method: 'POST' })
if (validation.valid === false || validation.is_valid === false) {
  throw new Error(`Workflow validation failed: ${JSON.stringify(validation)}`)
}
await api(`/workflow/${workflow.id}/publish`, { method: 'POST' })

console.log(`Published Sekol Tiles workflow ${workflowUuid}.`)
console.log(`Attached: compact appointment/check/callback tools, ${liveTransferUuid ? 'live transfer, ' : ''}end-call, and CRM transcript webhook.`)
console.log('Existing Dograh Groq, STT, TTS and telephony model selections were preserved.')
