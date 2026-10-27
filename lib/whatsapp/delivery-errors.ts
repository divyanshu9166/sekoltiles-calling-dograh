// Turns the `errors` array on a failed status webhook into one line the team
// can act on. Codes: https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes

export interface MetaStatusError {
  code?: number
  title?: string
  message?: string
  error_data?: { details?: string }
}

const STATUS_ERROR_TEXT: Record<number, string> = {
  131026: 'Not delivered: the number may not be on WhatsApp, or their app is too old.',
  131047: 'Not delivered: more than 24 hours since the customer last messaged. Send an approved template instead.',
  131049: 'Not delivered: Meta limited how many marketing messages this customer gets. Try again later.',
  131050: 'Not delivered: the customer turned off marketing messages from this business.',
  131051: 'Not delivered: WhatsApp does not support this message type.',
  131052: 'Not delivered: the media could not be downloaded from the customer\'s message.',
  131053: 'Not delivered: the media file could not be uploaded. Check the file type and size.',
  131056: 'Not delivered: too many messages to this customer in a short time. Wait and retry.',
  130429: 'Not delivered: sending too fast for your WhatsApp limit. Wait and retry.',
  130472: 'Not delivered: Meta held this message back as part of a marketing experiment.',
  131000: 'Not delivered: WhatsApp had an internal error. Retry in a few minutes.',
  131042: 'Not delivered: there is a payment problem on the WhatsApp Business account.',
  131031: 'Not delivered: the WhatsApp Business account is locked by Meta.',
  132000: 'Not delivered: the template variables do not match the approved template.',
  132001: 'Not delivered: the template does not exist in this language, or is not approved yet.',
  132005: 'Not delivered: the filled-in template text is too long.',
  132007: 'Not delivered: the template content breaks a WhatsApp policy.',
  132012: 'Not delivered: the template header or variables are in the wrong format (for example, a photo header with no photo).',
  132015: 'Not delivered: the template is paused because of low quality.',
  132016: 'Not delivered: the template is disabled because of low quality.',
  368: 'Not delivered: the business number is temporarily blocked for policy violations.',
}

export function describeStatusErrors(errors: MetaStatusError[] | undefined | null): string {
  const first = errors?.[0]
  if (!first) return 'Not delivered.'
  if (first.code !== undefined && STATUS_ERROR_TEXT[first.code]) return STATUS_ERROR_TEXT[first.code]
  const detail = first.error_data?.details || first.message || first.title
  const code = first.code !== undefined ? ` (#${first.code})` : ''
  return `Not delivered: ${detail || 'unknown reason'}${code}`
}

/** Meta's own "stop marketing messages" signal from the customer's WhatsApp app. */
export function isMarketingOptOutError(errors: MetaStatusError[] | undefined | null) {
  return !!errors?.some((e) => e.code === 131050)
}
