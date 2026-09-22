/** Helpers shared by the bulk-call webhook and sequential campaign worker. */

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
