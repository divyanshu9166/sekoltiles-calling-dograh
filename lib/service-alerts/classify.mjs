import { createHash } from 'node:crypto'

// Store only diagnostic text, never request bodies, headers or credentials.
export function redactDiagnostic(value, secrets = []) {
  let text = String(value || '').replace(/\x1b\[[0-9;]*m/g, '')
  for (const secret of secrets) if (typeof secret === 'string' && secret.length > 5) text = text.split(secret).join('[REDACTED]')
  return text
    .replace(/\b(?:gsk_|sk-proj-|sk-)[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|api[_-]?subscription[_-]?key|auth[_-]?token|auth[_-]?secret|authorization|password|x-api-secret)\s*["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1[REDACTED]')
    .replace(/https?:\/\/[^\s"'<>]+/g, '[URL REDACTED]')
    .replace(/[\r\n\t]+/g, ' ').slice(0, 1600)
}

export function classifyServiceFailure({ message, processor = '', source = '', runId = null, timestamp = new Date(), secrets = [] }) {
  const text = `${processor} ${message}`
  const component = /stt|speech.to.text|transcri/i.test(processor + ' ' + source) ? 'STT'
    : /tts|text.to.speech/i.test(processor + ' ' + source) ? 'TTS'
    : /llm|groq|openai|qwen|anthropic/i.test(text + ' ' + source) ? 'LLM' : 'TELEPHONY'
  const service = /sarvam|saaras|bulbul/i.test(text) ? 'sarvam'
    : /vobiz/i.test(text + ' ' + source) ? 'vobiz'
    : component === 'LLM' ? 'llm' : /dograh|ari|telephony/i.test(source + ' ' + text) ? 'dograh' : null
  if (!service) return null
  // Ordinary busy/no-answer, SIP auth challenges and OPTIONS 405 are not outages.
  if (/\b(?:busy|no.answer|user_hangup|customer_declined)\b/i.test(message) && !/error|credit|fail|timeout/i.test(message)) return null
  const credit = /credits?\s+(?:exhausted|depleted)|insufficient[_\s-]*(?:quota|balance|credit|funds)|out of credits|payment.required|\b402\b/i.test(message)
  const rate = /rate.?limit|too many requests|\b429\b|tokens per minute|\btpm\b/i.test(message)
  const auth = /invalid[_\s-]*(?:api[_\s-]*key|credential|token)|authentication.failed|unauthorized|\b403\b|\b401\b/i.test(message)
  const timeout = /timed?\s*out|timeout|no.response|empty.response|empty.completion|no BotStartedSpeakingFrame/i.test(message)
  const connection = /connection.*(?:fail|refused|closed)|unreachable|no route to host|network/i.test(message)
  const code = credit ? 'CREDITS_EXHAUSTED' : rate ? 'RATE_LIMITED' : auth ? 'AUTHENTICATION_FAILED'
    : timeout ? 'NO_RESPONSE' : connection ? 'CONNECTION_FAILED' : 'PROVIDER_ERROR'
  const label = service === 'llm' ? 'LLM API' : service === 'dograh' ? 'Calling engine' : service === 'sarvam' ? 'Sarvam' : 'Vobiz'
  const reason = { CREDITS_EXHAUSTED: 'Credits exhausted', RATE_LIMITED: 'Rate limit reached', AUTHENTICATION_FAILED: 'Credentials rejected', NO_RESPONSE: 'No response / timeout', CONNECTION_FAILED: 'Connection failed', PROVIDER_ERROR: 'Provider error' }[code]
  const action = credit ? `Add credits in the ${label} billing dashboard, then verify with a test call.`
    : rate ? 'Check provider request/token limits and Retry-After. Wait for reset or increase the approved limit.'
    : auth ? 'Check the configured provider API credentials and account permissions.'
    : timeout ? 'Check provider availability, model settings and network; test again before resuming calling.'
    : 'Review the provider error below and verify connectivity and account settings with a test call.'
  const observedAt = new Date(timestamp)
  if (!Number.isFinite(observedAt.getTime())) return null
  const fingerprint = `${service}:${component}:${code}`
  return {
    fingerprint, service, component, code,
    severity: rate ? 'WARNING' : 'CRITICAL', title: `${label}${component === 'STT' || component === 'TTS' ? ' ' + component : ''}: ${reason}`,
    message: redactDiagnostic(message, secrets), action, observedAt,
    runId: runId != null && /^\d+$/.test(String(runId)) ? String(runId) : null,
    // Thousands of error frames in one failed call become ONE affected-call event.
    eventKey: createHash('sha256').update(`${fingerprint}:${runId || Math.floor(observedAt.getTime() / 300000)}`).digest('hex'),
  }
}

export function failureFromLog(line, secrets = []) {
  const clean = line.replace(/\x1b\[[0-9;]*m/g, '')
  const match = clean.match(/DOGRAH_FAILURE \[src=(\w+) type=[^\]]*\] \[owner=[^\]]*\]\s*(.*)/)
  // Structured runtime failures, not arbitrary text/headers/transcripts in logs.
  if (!match || !['stt', 'tts', 'llm', 'telephony'].includes(match[1])) return null
  return classifyServiceFailure({
    message: match[2], source: match[1],
    processor: `${match[1]} ${clean.match(/code=([^\s\]]+)/)?.[1] || ''}`,
    runId: clean.match(/run_id=(\d+)/)?.[1],
    timestamp: clean.match(/^(\d{4}-\d{2}-\d{2}T[^ ]+)/)?.[1] || new Date(), secrets,
  })
}

export function failureFromFeedback(event, runId, secrets = []) {
  if (event.type !== 'rtf-pipeline-error') return null
  return classifyServiceFailure({ message: event.payload?.error || '', processor: event.payload?.processor || '',
    timestamp: event.timestamp, runId, secrets })
}
