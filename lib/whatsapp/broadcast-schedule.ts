// Validates the `scheduled_at` a client sends when creating a broadcast.

export const MIN_SCHEDULE_LEAD_MS = 60_000
export const MAX_SCHEDULE_AHEAD_MS = 90 * 24 * 60 * 60 * 1000

export function parseScheduledAt(
  value: unknown,
  now: number = Date.now(),
): { scheduledAt: Date | null } | { error: string } {
  if (value === undefined || value === null || value === '') return { scheduledAt: null }
  if (typeof value !== 'string') return { error: 'scheduled_at must be an ISO date string' }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return { error: 'scheduled_at is not a valid date' }
  if (date.getTime() < now + MIN_SCHEDULE_LEAD_MS) {
    return { error: 'Pick a send time at least a minute from now.' }
  }
  if (date.getTime() > now + MAX_SCHEDULE_AHEAD_MS) {
    return { error: 'Broadcasts can be scheduled up to 90 days ahead.' }
  }
  return { scheduledAt: date }
}
