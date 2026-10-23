// ------------------------------------------------------------
// WhatsApp 24-hour customer-service window.
//
// Meta only allows free-form text within 24h of the contact's LAST
// INBOUND (customer) message. Outside that window the only way to message
// first is a pre-approved template (HSM). This pure helper answers the
// "is the window open?" question so callers can pick text vs. template.
// ------------------------------------------------------------

export const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000

/** True when free-form text is still allowed (within 24h of last inbound). */
export function isSessionWindowOpen(
    lastInboundAt: Date | null | undefined,
    now: Date = new Date(),
): boolean {
    if (!lastInboundAt) return false
    const elapsed = now.getTime() - new Date(lastInboundAt).getTime()
    // Future-dated inbound (clock skew) is treated as open.
    return elapsed < SESSION_WINDOW_MS
}

/** Milliseconds left in the window (0 when closed or never opened). */
export function sessionWindowRemainingMs(
    lastInboundAt: Date | null | undefined,
    now: Date = new Date(),
): number {
    if (!lastInboundAt) return 0
    const remaining = SESSION_WINDOW_MS - (now.getTime() - new Date(lastInboundAt).getTime())
    return remaining > 0 ? remaining : 0
}
