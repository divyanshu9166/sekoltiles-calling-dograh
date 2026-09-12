import { SEKOL_DOGRAH_PROMPT } from '../lib/calling-agent/prompt.mjs'

const rawBase = process.env.DOGRAH_API_URL?.trim().replace(/\/+$/, '')
const apiKey = process.env.DOGRAH_API_KEY?.trim()
const workflowUuid = process.env.DOGRAH_WORKFLOW_UUID?.trim()
const crmSecret = process.env.CRM_API_SECRET?.trim()
const crmPublicUrl = (process.env.CRM_PUBLIC_URL || '').trim().replace(/\/+$/, '')

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

const commonAppointmentParameters = [
  stringParameter('date', 'Confirmed appointment date in YYYY-MM-DD format.'),
  stringParameter('time', 'Confirmed India-time slot: 10:00 AM, 11:00 AM, 12:00 PM, 2:00 PM, 3:00 PM, 4:00 PM, or 5:00 PM.'),
  stringParameter('purpose', 'Short confirmed purpose for the showroom appointment.'),
  stringParameter('notes', 'Optional useful details from the conversation. Do not include invented information.', false),
]

const outboundAppointmentUuid = await upsertTool({
  name: 'book_outbound_appointment',
  description: 'Book an outbound customer appointment using the CRM-supplied name, phone and region. Never ask the customer for known name or phone. Use only after date, time and purpose are confirmed.',
  category: 'http_api',
  icon: 'calendar-check',
  icon_color: '#D97706',
  definition: {
    schema_version: 1,
    type: 'http_api',
    config: {
      method: 'POST',
      url: `${crmPublicUrl}/api/appointments/create`,
      credential_uuid: credentialUuid,
      parameters: commonAppointmentParameters,
      preset_parameters: [
        { name: 'customerName', type: 'string', value_template: '{{initial_context.customer_name}}', required: true },
        { name: 'phone', type: 'string', value_template: '{{initial_context.phone_number}}', required: true },
        { name: 'region', type: 'string', value_template: '{{initial_context.region}}', required: false },
      ],
      timeout_ms: 10_000,
    },
  },
})

const inboundAppointmentUuid = await upsertTool({
  name: 'book_inbound_appointment',
  description: 'Book an inbound caller appointment. The caller phone is already supplied; collect customer name, date, time and purpose before using this tool.',
  category: 'http_api',
  icon: 'calendar-check',
  icon_color: '#0F766E',
  definition: {
    schema_version: 1,
    type: 'http_api',
    config: {
      method: 'POST',
      url: `${crmPublicUrl}/api/appointments/create`,
      credential_uuid: credentialUuid,
      parameters: [
        stringParameter('customerName', 'Customer full name stated by the inbound caller.'),
        ...commonAppointmentParameters,
      ],
      preset_parameters: [
        { name: 'phone', type: 'string', value_template: '{{initial_context.caller_number}}', required: true },
      ],
      timeout_ms: 10_000,
    },
  },
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
const definition = {
  nodes: [
    {
      id: 'sekol-start',
      type: 'startCall',
      position: { x: 160, y: 100 },
      data: {
        name: 'Sekol Tiles - Anushka',
        prompt: SEKOL_DOGRAH_PROMPT,
        greeting_type: 'text',
        greeting: 'नमस्ते! Sekol Tiles में आपका स्वागत है, मैं अनुष्का AI सहायक बोल रही हूँ। कैसे मदद करूँ?',
        allow_interrupt: true,
        add_global_prompt: false,
        delayed_start: false,
        extraction_enabled: false,
        tool_uuids: [outboundAppointmentUuid, inboundAppointmentUuid, endCallUuid],
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
console.log('Attached: outbound appointment, inbound appointment, end-call, and CRM transcript webhook.')
console.log('Existing Dograh Groq, STT, TTS and telephony model selections were preserved.')
