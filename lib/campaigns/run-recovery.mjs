/** Helpers shared by the bulk-call webhook and sequential campaign worker. */

export function campaignRecoveryTimeoutMs(value) {
  const seconds = Number(value || 40)
  return (Number.isFinite(seconds) ? Math.max(40, seconds) : 40) * 1000
}

export function isCampaignCapacityError(error) {
  return error?.status === 429 && error?.detail === 'Concurrent call limit reached'
}

export async function reconcileAriCampaignRun(request, runId, runPath) {
  const result = await request(`/public/agent/runs/${encodeURIComponent(runId)}/reconcile`, { method: 'POST' })
  // A timer is only a reason to check the PBX. Never free the CRM queue while
  // the channel still exists or while the provider's status is unknown.
  if (!['recovered', 'completed'].includes(result?.status)) return null
  const run = await request(runPath)
  return run?.is_completed ? run : null
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
