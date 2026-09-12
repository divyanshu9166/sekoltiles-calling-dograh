import 'server-only'

type DograhEnvironment = Record<string, string | undefined>

type TriggerCallInput = {
  phoneNumber: string
  customerName: string
  reason: string
  region: string
  crmCallLogId: number
}

export type DograhCallResponse = {
  status: string
  workflow_run_id: number
  workflow_run_name: string
}

export type DograhRealtimeEvent = {
  type?: string
  timestamp?: string
  payload?: { text?: string; final?: boolean; timestamp?: string }
}

export type DograhWorkflowRun = {
  id: number
  workflow_id: number
  name?: string
  created_at?: string
  is_completed?: boolean
  call_type?: string
  transcript_url?: string | null
  transcript_public_url?: string | null
  recording_public_url?: string | null
  initial_context?: Record<string, unknown> | null
  gathered_context?: Record<string, unknown> | null
  cost_info?: { call_duration_seconds?: number } | null
  logs?: { realtime_feedback_events?: DograhRealtimeEvent[] } | null
}

function required(name: string, env: DograhEnvironment) {
  const value = env[name]?.trim()
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

export function dograhBaseUrl(env: DograhEnvironment = process.env) {
  const configured = required('DOGRAH_API_URL', env).replace(/\/+$/, '')
  return configured.endsWith('/api/v1') ? configured : `${configured}/api/v1`
}

function optionalInteger(name: string, env: DograhEnvironment) {
  const value = env[name]?.trim()
  if (!value) return undefined
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a positive integer`)
  return Number(value)
}

async function dograhRequest<T>(
  path: string,
  init: RequestInit = {},
  env: DograhEnvironment = process.env,
  request: typeof fetch = fetch,
): Promise<T> {
  const response = await request(`${dograhBaseUrl(env)}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': required('DOGRAH_API_KEY', env),
      ...init.headers,
    },
    cache: 'no-store',
    signal: init.signal ?? AbortSignal.timeout(10_000),
  })

  if (!response.ok) {
    let detail = `Dograh request failed (${response.status})`
    try {
      const body = await response.json() as { detail?: string | Array<{ msg?: string }> }
      if (typeof body.detail === 'string') detail = body.detail
      else if (Array.isArray(body.detail)) detail = body.detail.map(item => item.msg).filter(Boolean).join(', ') || detail
    } catch {
      // Keep the status-based message when the upstream did not return JSON.
    }
    throw new Error(detail)
  }

  return response.json() as Promise<T>
}

export async function triggerDograhCall(
  input: TriggerCallInput,
  env: DograhEnvironment = process.env,
  request: typeof fetch = fetch,
) {
  const workflowUuid = required('DOGRAH_WORKFLOW_UUID', env)
  const telephonyConfigurationId = optionalInteger('DOGRAH_TELEPHONY_CONFIGURATION_ID', env)
  const fromPhoneNumberId = optionalInteger('DOGRAH_FROM_PHONE_NUMBER_ID', env)
  const greeting = `नमस्ते ${input.customerName || 'ग्राहक'} जी, मैं अनुष्का, Sekol Tiles से बोल रही हूँ। क्या अभी थोड़ी बात करना सुविधाजनक रहेगा?`

  return dograhRequest<DograhCallResponse>(
    `/public/agent/workflow/${encodeURIComponent(workflowUuid)}`,
    {
      method: 'POST',
      body: JSON.stringify({
        phone_number: input.phoneNumber,
        initial_context: {
          direction: 'outbound',
          customer_name: input.customerName || 'Customer',
          called_number: input.phoneNumber,
          reason: input.reason,
          region: input.region,
          crm_call_log_id: input.crmCallLogId,
          // Dograh uses this reserved context key to speak a deterministic
          // opening through TTS instead of asking the LLM for a system-only
          // first turn (which Groq Qwen correctly rejects).
          greeting_override: { type: 'text', text: greeting },
          // Keep the plain value available to workflow prompt templates.
          call_greeting: greeting,
          source: 'sekol-calling-crm',
        },
        ...(telephonyConfigurationId ? { telephony_configuration_id: telephonyConfigurationId } : {}),
        ...(fromPhoneNumberId ? { from_phone_number_id: fromPhoneNumberId } : {}),
      }),
    },
    env,
    request,
  )
}

export async function checkDograhHealth(
  env: DograhEnvironment = process.env,
  request: typeof fetch = fetch,
) {
  const response = await request(`${dograhBaseUrl(env)}/health`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(3_000),
  })
  return response.ok
}

async function dograhWorkflowId(
  env: DograhEnvironment = process.env,
  request: typeof fetch = fetch,
) {
  const configured = optionalInteger('DOGRAH_WORKFLOW_ID', env)
  if (configured) return configured

  const workflowUuid = required('DOGRAH_WORKFLOW_UUID', env)
  const workflows = await dograhRequest<Array<{ id: number; uuid?: string; workflow_uuid?: string }>>('/workflow/fetch', {}, env, request)
  const workflow = workflows.find(item => (item.workflow_uuid || item.uuid) === workflowUuid)
  if (!workflow) throw new Error(`Dograh workflow ${workflowUuid} was not found`)
  return workflow.id
}

export async function listDograhRuns(
  limit = 25,
  env: DograhEnvironment = process.env,
  request: typeof fetch = fetch,
) {
  const workflowId = await dograhWorkflowId(env, request)
  return dograhRequest<{ runs: DograhWorkflowRun[] }>(
    `/workflow/${workflowId}/runs?limit=${Math.max(1, Math.min(limit, 100))}`,
    {},
    env,
    request,
  )
}

export async function getDograhRun(
  runId: number,
  env: DograhEnvironment = process.env,
  request: typeof fetch = fetch,
) {
  const workflowId = await dograhWorkflowId(env, request)
  return dograhRequest<DograhWorkflowRun>(`/workflow/${workflowId}/runs/${runId}`, {}, env, request)
}
