// Meta reports template status in UPPERCASE; the templates table uses TitleCase.
// Shared by the template sync route and the template-status webhook.

export type TemplateStatus = 'Draft' | 'Pending' | 'Approved' | 'Rejected'

export function normalizeTemplateStatus(meta: string): TemplateStatus {
  switch (meta.toUpperCase()) {
    case 'APPROVED':
    case 'REINSTATED':
    case 'FLAGGED': // still sendable; paused later if quality stays low
      return 'Approved'
    case 'PENDING':
    case 'IN_APPEAL':
    case 'PENDING_DELETION':
      return 'Pending'
    case 'REJECTED':
    case 'DISABLED':
    case 'PAUSED':
      return 'Rejected'
    default:
      return 'Draft'
  }
}

/**
 * Reason to show next to a template after a status webhook, or null when the
 * template is usable. Meta sends reasons like "INCORRECT_CATEGORY"; PAUSED and
 * DISABLED come without one.
 */
export function templateStatusReason(event: string, reason?: string | null): string | null {
  const upper = event.toUpperCase()
  const readable = reason && reason.toUpperCase() !== 'NONE'
    ? reason.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())
    : null
  if (upper === 'REJECTED') return readable ? `Rejected: ${readable}` : 'Rejected by Meta'
  if (upper === 'PAUSED') return 'Paused by Meta because customers reported or blocked it'
  if (upper === 'DISABLED') return 'Disabled by Meta because of repeated low quality'
  if (upper === 'FLAGGED') return 'Flagged for low quality. Meta pauses it if quality stays low'
  return null
}

export interface TemplateStatusChange {
  /** New status, or undefined to keep the current one. */
  status?: TemplateStatus
  reason: string | null
  /** The template is gone on Meta, so the row can be submitted again. */
  forgetMetaId?: boolean
}

/**
 * What a message_template_status_update event does to the stored row, or
 * null for events that don't concern the template itself.
 */
export function templateStatusChange(event: string, reason?: string | null): TemplateStatusChange | null {
  switch (event.toUpperCase()) {
    case 'LIMIT_EXCEEDED':
      return null
    case 'DELETED':
      return { status: 'Draft', reason: 'Deleted in WhatsApp Manager', forgetMetaId: true }
    case 'ARCHIVED':
      return { status: 'Draft', reason: 'Archived in WhatsApp Manager. Unarchive it there to use it again' }
    case 'UNARCHIVED':
      return { reason: 'Unarchived in WhatsApp Manager. Run "Sync from Meta" to refresh its status' }
    default:
      return { status: normalizeTemplateStatus(event), reason: templateStatusReason(event, reason) }
  }
}
