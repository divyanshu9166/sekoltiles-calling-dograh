// Pure rules for the WhatsApp sales pipeline (no database access), shared by
// the webhook, the pipeline API routes and the board UI.

export const DEFAULT_PIPELINE_NAME = 'Sales Pipeline'

export const DEFAULT_STAGES = [
  { name: 'New Lead', color: '#3b82f6', position: 0 },
  { name: 'Qualified', color: '#eab308', position: 1 },
  { name: 'Proposal Sent', color: '#f97316', position: 2 },
  { name: 'Negotiation', color: '#8b5cf6', position: 3 },
  { name: 'Won', color: '#22c55e', position: 4 },
]

const NOTE_LIMIT = 500

/** Title and notes for a deal created from a WhatsApp inquiry. */
export function buildLeadDeal(contact: { name?: string | null; phone: string }, firstMessage?: string | null) {
  const name = contact.name?.trim()
  const title = name && name !== contact.phone ? name : `+${contact.phone.replace(/^\+/, '')}`
  const text = firstMessage?.trim()
  const notes = text
    ? `WhatsApp inquiry: ${text.length > NOTE_LIMIT ? `${text.slice(0, NOTE_LIMIT)}…` : text}`
    : 'WhatsApp inquiry'
  return { title, notes }
}

/** A stage named "Won" closes the deal as won; any other stage reopens it. */
export function isWonStage(stage: { name: string } | null | undefined) {
  return !!stage && stage.name.trim().toLowerCase() === 'won'
}

/** Status a deal should get when it is dragged into `stage`, or null to keep it. */
export function statusForStageMove(currentStatus: string | null | undefined, stage: { name: string }) {
  if (isWonStage(stage)) return currentStatus === 'won' ? null : 'won'
  return currentStatus === 'won' ? 'open' : null
}

/**
 * The date input sends "YYYY-MM-DD"; Prisma DateTime needs a full instant.
 * Returns undefined for invalid input so callers can reject it.
 */
export function parseDealDate(value: unknown): Date | null | undefined {
  if (value === null || value === '') return null
  if (typeof value !== 'string') return undefined
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

/** "YYYY-MM-DD" for a stored date, the format `<input type="date">` expects. */
export function toDateInputValue(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}
