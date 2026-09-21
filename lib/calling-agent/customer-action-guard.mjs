const APPOINTMENT_ACTIONS = new Set(['check', 'book', 'reschedule'])
const CATALOGUE_INTENT = /\b(?:catalog|catalogue|brochure)\b|कैटलॉग|कैटालॉग/i
const APPOINTMENT_INTENT = /\b(?:appointment|showroom|visit|slot)\b|अपॉइंटमेंट|शोरूम|मुलाकात/i

export function isCatalogueMisroutedToAppointment(body) {
  const action = typeof body?.action === 'string' ? body.action.trim().toLowerCase() : ''
  if (!APPOINTMENT_ACTIONS.has(action)) return false

  const intentText = [body?.purpose, body?.reason]
    .filter((value) => typeof value === 'string')
    .join(' ')
  const hasBookingDetails = [body?.date, body?.spokenDate, body?.time]
    .some((value) => typeof value === 'string' && value.trim())

  return CATALOGUE_INTENT.test(intentText)
    && !APPOINTMENT_INTENT.test(intentText)
    && !hasBookingDetails
}
