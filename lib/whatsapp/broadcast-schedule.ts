// Validates the `scheduled_at` a client sends when creating a broadcast.

const DAY_MS = 24 * 60 * 60 * 1000

export const MIN_SCHEDULE_LEAD_MS = 60_000
export const MAX_SCHEDULE_AHEAD_MS = 90 * DAY_MS
/**
 * Meta deletes uploaded media 30 days after upload, so a broadcast with a
 * header photo/video/PDF must go out before then.
 */
export const MAX_MEDIA_SCHEDULE_AHEAD_MS = 29 * DAY_MS

/** The latest allowed send time, as an error message when `at` is past it. */
export function scheduleTooFarError(at: number, now: number, hasHeaderMedia: boolean): string | null {
  if (hasHeaderMedia && at > now + MAX_MEDIA_SCHEDULE_AHEAD_MS) {
    return 'A broadcast with a header photo, video or PDF can be scheduled up to 29 days ahead (WhatsApp deletes the uploaded file after 30 days).'
  }
  if (at > now + MAX_SCHEDULE_AHEAD_MS) return 'Broadcasts can be scheduled up to 90 days ahead.'
  return null
}

export function parseScheduledAt(
  value: unknown,
  now: number = Date.now(),
  options: { hasHeaderMedia?: boolean } = {},
): { scheduledAt: Date | null } | { error: string } {
  if (value === undefined || value === null || value === '') return { scheduledAt: null }
  if (typeof value !== 'string') return { error: 'scheduled_at must be an ISO date string' }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return { error: 'scheduled_at is not a valid date' }
  if (date.getTime() < now + MIN_SCHEDULE_LEAD_MS) {
    return { error: 'Pick a send time at least a minute from now.' }
  }
  const tooFar = scheduleTooFarError(date.getTime(), now, !!options.hasHeaderMedia)
  if (tooFar) return { error: tooFar }
  return { scheduledAt: date }
}
