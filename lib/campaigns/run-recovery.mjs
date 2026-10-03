/** Helpers shared by the bulk-call webhook and sequential campaign worker. */

export function campaignRecoveryTimeoutMs(value) {
  const seconds = Number(value || 40)
  return (Number.isFinite(seconds) ? Math.max(40, seconds) : 40) * 1000
}

export function hasConnectedCampaignMedia(run) {
  const context = run?.gathered_context || {}
  const lifecycle = context.call_status || context.call_disposition
  if (lifecycle && isTerminalCampaignLifecycle(lifecycle)) return false
  return !!(context.ext_channel_id || context.bridge_id || run?.state === 'running')
}

export function isTerminalCampaignLifecycle(value) {
  const status = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (!status) return false
  const active = new Set([
    'ring', 'ringing', 'progress', 'answer', 'answered', 'queued',
    'initiated', 'active', 'in_progress', 'connecting',
  ])
  return !active.has(status) && !status.endsWith('_answered')
}

export function isStaleCampaignRun(startedAt, now = Date.now(), maxAgeMs = 10 * 60_000) {
  const started = startedAt instanceof Date ? startedAt.getTime() : new Date(startedAt || 0).getTime()
  return Number.isFinite(started) && started > 0 && now - started >= maxAgeMs
}
