/**
 * Meta WhatsApp Cloud API helpers.
 *
 * Every function takes a single options object (named parameters) instead
 * of positional arguments. This was a deliberate choice after the same
 * swapped-args bug was found four times in a row with the positional form
 * (e.g. `(accessToken, phoneNumberId)` vs `(phoneNumberId, accessToken)`).
 * With named params, a typo surfaces immediately as a TypeScript error
 * instead of a runtime rejection from Meta.
 */

const META_API_VERSION = process.env.WHATSAPP_GRAPH_API_VERSION ?? 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

export interface MetaSendResult {
  messageId: string
}

export interface MetaPhoneInfo {
  id: string
  display_phone_number: string
  verified_name?: string
  quality_rating?: string
}



interface MetaErrorResponse {
  error?: { message?: string; code?: number; type?: string }
}

async function throwMetaError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const data = (await response.json()) as MetaErrorResponse
    if (data.error?.message) message = data.error.message
  } catch {
    // response body wasn't JSON — keep the fallback
  }
  throw new Error(message)
}

// ============================================================
// Phone number / account
// ============================================================

export interface VerifyPhoneNumberArgs {
  phoneNumberId: string
  accessToken: string
}

/**
 * Verify a Meta phone number ID by fetching its public metadata
 * (display_phone_number, verified_name, quality_rating).
 */
export async function verifyPhoneNumber(
  args: VerifyPhoneNumberArgs
): Promise<MetaPhoneInfo> {
  const { phoneNumberId, accessToken } = args
  const url = `${META_API_BASE}/${phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  return response.json()
}

export interface RegisterPhoneNumberArgs {
  phoneNumberId: string
  accessToken: string
  pin: string
}

/**
 * Register a phone number with the WhatsApp Cloud API.
 * Required when the number shows "Pending" status in WhatsApp Manager
 * or when Meta returns error #133010 ("Account not registered").
 *
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/reference/registration
 */
export async function registerPhoneNumber(
  args: RegisterPhoneNumberArgs
): Promise<{ success: boolean }> {
  const { phoneNumberId, accessToken, pin } = args
  const url = `${META_API_BASE}/${phoneNumberId}/register`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      pin,
    }),
  })

  if (!response.ok) {
    await throwMetaError(response, `Phone registration failed: ${response.status}`)
  }

  return response.json()
}

// ============================================================
// Sending
// ============================================================

export interface SendTextMessageArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  text: string
  contextMessageId?: string
}

/**
 * Send a free-form WhatsApp text message.
 * Only works inside the 24-hour customer service window.
 */
export async function sendTextMessage(
  args: SendTextMessageArgs
): Promise<MetaSendResult> {
  const { phoneNumberId, accessToken, to, text, contextMessageId } = args
  const url = `${META_API_BASE}/${phoneNumberId}/messages`

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body: text },
  }

  if (contextMessageId) {
    body.context = { message_id: contextMessageId }
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.messages[0].id }
}

export interface TemplateComponentParams {
  /** Variables for the HEADER component (e.g. {{1}} in the header) */
  header?: string[]
  /** Variables for the BODY component (e.g. {{1}}, {{2}} in the body) — most common */
  body?: string[]
  /** Variables for BUTTON components (e.g. dynamic URL suffixes) */
  buttons?: Array<{ index: number; sub_type: 'url' | 'quick_reply'; value: string }>
}

export interface SendTemplateMessageArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  templateName: string
  language?: string
  /**
   * Legacy flat params array — assumed to be BODY parameters only.
   * Prefer `componentParams` for full control over header/body/button variables.
   */
  params?: string[]
  /** Fine-grained component params. Takes precedence over `params` if both provided. */
  componentParams?: TemplateComponentParams
  contextMessageId?: string
}

/**
 * Send a pre-approved WhatsApp message template. Required outside
 * the 24-hour window and for any first-touch messaging.
 *
 * IMPORTANT: If your template has variables in the HEADER or dynamic
 * URL BUTTONS (not just the body), use `componentParams` instead of
 * the legacy `params` array. Sending only body params when the template
 * expects header params causes Meta to accept the API call (200 OK) but
 * silently fail to render/deliver the message to the recipient.
 */
export async function sendTemplateMessage(
  args: SendTemplateMessageArgs
): Promise<MetaSendResult> {
  const {
    phoneNumberId,
    accessToken,
    to,
    templateName,
    language = 'en_US',
    params,
    componentParams,
    contextMessageId,
  } = args
  const url = `${META_API_BASE}/${phoneNumberId}/messages`

  const template: Record<string, unknown> = {
    name: templateName,
    language: { code: language },
  }

  // Build components array from fine-grained componentParams (preferred)
  // or fall back to the legacy flat `params` array (body-only).
  const components: Record<string, unknown>[] = []

  if (componentParams) {
    if (componentParams.header && componentParams.header.length > 0) {
      components.push({
        type: 'header',
        parameters: componentParams.header.map((p) => ({ type: 'text', text: String(p) })),
      })
    }
    if (componentParams.body && componentParams.body.length > 0) {
      components.push({
        type: 'body',
        parameters: componentParams.body.map((p) => ({ type: 'text', text: String(p) })),
      })
    }
    if (componentParams.buttons && componentParams.buttons.length > 0) {
      for (const btn of componentParams.buttons) {
        components.push({
          type: 'button',
          sub_type: btn.sub_type,
          index: String(btn.index),
          parameters: [
            btn.sub_type === 'url'
              ? { type: 'text', text: btn.value }
              : { type: 'payload', payload: btn.value },
          ],
        })
      }
    }
  } else if (params && params.length > 0) {
    // Legacy path: treat all params as body variables
    components.push({
      type: 'body',
      parameters: params.map((p) => ({ type: 'text', text: String(p) })),
    })
  }

  if (components.length > 0) {
    template.components = components
  }

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template,
  }

  if (contextMessageId) {
    body.context = { message_id: contextMessageId }
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.messages[0].id }
}

// ============================================================
// Reactions
// ============================================================

export interface SendReactionMessageArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  targetMessageId: string
  emoji: string
}

export async function sendReactionMessage(
  args: SendReactionMessageArgs
): Promise<MetaSendResult> {
  const { phoneNumberId, accessToken, to, targetMessageId, emoji } = args
  const url = `${META_API_BASE}/${phoneNumberId}/messages`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'reaction',
      reaction: { message_id: targetMessageId, emoji },
    }),
  })

  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }

  const data = await response.json()
  return { messageId: data.messages[0].id }
}

// ============================================================
// Media
// ============================================================

export interface GetMediaUrlArgs {
  mediaId: string
  accessToken: string
}

/**
 * Resolve a media ID to Meta's (short-lived, authenticated) CDN URL
 * plus the MIME type. Step one of the media-proxy flow.
 */
export async function getMediaUrl(
  args: GetMediaUrlArgs
): Promise<{ url: string; mimeType: string }> {
  const { mediaId, accessToken } = args
  const response = await fetch(`${META_API_BASE}/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Media fetch failed: ${response.status}`)
  }
  const data = await response.json()
  if (!data.url) throw new Error('Media URL not found in Meta response')
  return { url: data.url, mimeType: data.mime_type || 'application/octet-stream' }
}

export interface DownloadMediaArgs {
  downloadUrl: string
  accessToken: string
}

/**
 * Fetch the binary bytes for a media URL obtained from getMediaUrl.
 * Step two of the media-proxy flow.
 */
export async function downloadMedia(
  args: DownloadMediaArgs
): Promise<{ buffer: Buffer; contentType: string }> {
  const { downloadUrl, accessToken } = args
  const response = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    throw new Error(`Media download failed: ${response.status}`)
  }
  const contentType =
    response.headers.get('content-type') || 'application/octet-stream'
  const buffer = Buffer.from(await response.arrayBuffer())
  return { buffer, contentType }
}

// ============================================================
// Interactive Messages (quick-reply buttons)
// ============================================================

export interface QuickReplyButton {
  /** Unique payload id — returned in webhook as button_reply.id (max 256 chars) */
  id: string
  /** Label displayed on the button (max 20 chars) */
  title: string
}

export interface SendInteractiveButtonMessageArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  /** Main message body text */
  bodyText: string
  /** Optional header text shown above the body */
  headerText?: string
  /** Optional footer text shown below the buttons */
  footerText?: string
  /** 1–3 quick-reply buttons */
  buttons: QuickReplyButton[]
}

/**
 * Send a WhatsApp interactive message with up to 3 quick-reply buttons.
 *
 * Works inside the 24-hour customer service window (i.e., the customer
 * messaged you first). For first-touch outreach, use sendTemplateMessage.
 *
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-reply-buttons-messages
 */
export async function sendInteractiveButtonMessage(
  args: SendInteractiveButtonMessageArgs,
): Promise<MetaSendResult> {
  const { phoneNumberId, accessToken, to, bodyText, headerText, footerText, buttons } = args

  if (buttons.length === 0 || buttons.length > 3) {
    throw new Error('Interactive button messages require 1–3 buttons')
  }

  const url = `${META_API_BASE}/${phoneNumberId}/messages`

  const interactive: Record<string, unknown> = {
    type: 'button',
    body: { text: bodyText },
    action: {
      buttons: buttons.map((btn) => ({
        type: 'reply',
        reply: { id: btn.id, title: btn.title },
      })),
    },
  }

  if (headerText) {
    interactive.header = { type: 'text', text: headerText }
  }

  if (footerText) {
    interactive.footer = { text: footerText }
  }

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive,
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    await throwMetaError(response, `Meta API error (interactive): ${response.status}`)
  }

  const data = await response.json()
  return { messageId: data.messages[0].id }
}
