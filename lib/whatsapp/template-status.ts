// Meta reports template status in UPPERCASE; the templates table uses TitleCase.
// Shared by the template sync route and the template-status webhook.

export type TemplateStatus = 'Draft' | 'Pending' | 'Approved' | 'Rejected'

export function normalizeTemplateStatus(meta: string): TemplateStatus {
  switch (meta.toUpperCase()) {
    case 'APPROVED':
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
  return null
}
