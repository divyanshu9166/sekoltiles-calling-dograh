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

const META_API_VERSION = process.env.WHATSAPP_GRAPH_API_VERSION ?? 'v24.0'
// WHATSAPP_GRAPH_API_BASE is only for pointing local tests at a mock Graph API.
const META_API_BASE =
  process.env.WHATSAPP_GRAPH_API_BASE ?? `https://graph.facebook.com/${META_API_VERSION}`

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

/** A Graph API error, keeping Meta's numeric code (e.g. 130429) and the HTTP status. */
export class MetaApiError extends Error {
  readonly code?: number
  readonly httpStatus: number

  constructor(message: string, httpStatus: number, code?: number) {
    super(message)
    this.name = 'MetaApiError'
    this.httpStatus = httpStatus
    this.code = code
  }
}

async function throwMetaError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  let code: number | undefined
  try {
    const data = (await response.json()) as MetaErrorResponse
    if (data.error?.message) message = data.error.message
    if (typeof data.error?.code === 'number') code = data.error.code
  } catch {
    // response body wasn't JSON — keep the fallback
  }
  throw new MetaApiError(message, response.status, code)
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
  /**
   * Variables for BUTTON components: a website button's URL suffix, a quick
   * reply's payload, or the code a Copy offer code button copies.
   */
  buttons?: Array<{ index: number; sub_type: 'url' | 'quick_reply' | 'copy_code'; value: string }>
  /** Pin for a template with a LOCATION header, chosen per send. */
  headerLocation?: TemplateHeaderLocation
  /**
   * Photo, video or document for a template with a media HEADER. Meta
   * rejects (#132012) a media-header template sent without one.
   */
  headerMedia?: TemplateHeaderMedia
}

export interface TemplateHeaderLocation {
  latitude: number
  longitude: number
  name?: string
  address?: string
}

export interface TemplateHeaderMedia {
  type: 'image' | 'video' | 'document'
  /** Media ID from uploadMedia. */
  id: string
  /** Shown as the document's name. */
  filename?: string
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
    if (componentParams.headerMedia) {
      const { type, id, filename } = componentParams.headerMedia
      const media: Record<string, string> = { id }
      if (type === 'document' && filename) media.filename = filename
      components.push({ type: 'header', parameters: [{ type, [type]: media }] })
    } else if (componentParams.headerLocation) {
      const { latitude, longitude, name, address } = componentParams.headerLocation
      components.push({
        type: 'header',
        parameters: [
          {
            type: 'location',
            location: {
              latitude: String(latitude),
              longitude: String(longitude),
              ...(name ? { name } : {}),
              ...(address ? { address } : {}),
            },
          },
        ],
      })
    } else if (componentParams.header && componentParams.header.length > 0) {
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
              : btn.sub_type === 'copy_code'
                ? { type: 'coupon_code', coupon_code: btn.value }
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

export interface UploadMediaArgs {
  phoneNumberId: string
  accessToken: string
  file: Blob
  filename: string
  mimeType: string
}

/**
 * Upload a file to Meta so it can be sent by ID. Meta keeps uploaded media
 * for 30 days, and the same ID works with getMediaUrl for the inbox preview.
 *
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media
 */
export async function uploadMedia(args: UploadMediaArgs): Promise<{ mediaId: string }> {
  const { phoneNumberId, accessToken, file, filename, mimeType } = args
  const form = new FormData()
  form.append('messaging_product', 'whatsapp')
  form.append('type', mimeType)
  form.append('file', new Blob([await file.arrayBuffer()], { type: mimeType }), filename)

  const response = await fetch(`${META_API_BASE}/${phoneNumberId}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  })
  if (!response.ok) {
    await throwMetaError(response, `Media upload failed: ${response.status}`)
  }
  const data = await response.json()
  if (!data.id) throw new Error('Media ID not found in Meta response')
  return { mediaId: String(data.id) }
}

export interface SendMediaMessageArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  kind: 'image' | 'document' | 'video' | 'audio'
  mediaId: string
  /** Ignored for audio, which WhatsApp sends without a caption. */
  caption?: string
  /** Shown to the customer as the document's name. */
  filename?: string
  contextMessageId?: string
}

/**
 * Send an uploaded image, document, video or audio file. Like text, free-form
 * media only works inside the 24-hour customer service window.
 */
export async function sendMediaMessage(args: SendMediaMessageArgs): Promise<MetaSendResult> {
  const { phoneNumberId, accessToken, to, kind, mediaId, caption, filename, contextMessageId } = args

  const media: Record<string, string> = { id: mediaId }
  if (caption && kind !== 'audio') media.caption = caption
  if (kind === 'document' && filename) media.filename = filename

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: kind,
    [kind]: media,
  }
  if (contextMessageId) {
    body.context = { message_id: contextMessageId }
  }

  const response = await fetch(`${META_API_BASE}/${phoneNumberId}/messages`, {
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
// Read receipts and typing indicator
// ============================================================

export interface MarkMessageReadArgs {
  phoneNumberId: string
  accessToken: string
  /** WhatsApp ID (wamid) of the customer's latest message. */
  messageId: string
  /** Also show "typing…" to the customer until the reply is sent (max 25 s). */
  typing?: boolean
}

/**
 * Mark a customer's message (and every earlier one) as read, so they see
 * blue ticks. With `typing`, WhatsApp also shows a typing indicator.
 *
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/typing-indicators
 */
export async function markMessageRead(args: MarkMessageReadArgs): Promise<void> {
  const { phoneNumberId, accessToken, messageId, typing } = args
  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId,
  }
  if (typing) body.typing_indicator = { type: 'text' }

  const response = await fetch(`${META_API_BASE}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Mark as read failed: ${response.status}`)
  }
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

// ============================================================
// Template submission
// ============================================================

interface MetaTemplateErrorResponse {
  error?: {
    message?: string
    error_user_title?: string
    error_user_msg?: string
  }
}

/**
 * Template review errors carry the useful text in error_user_title /
 * error_user_msg ("Invalid parameter" alone tells the user nothing).
 */
async function throwMetaTemplateError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const { error } = (await response.json()) as MetaTemplateErrorResponse
    const title = error?.error_user_title?.trim()
    const detail = error?.error_user_msg?.trim()
    if (title && detail) message = `${title}: ${detail}`
    else if (detail || title) message = (detail || title) as string
    else if (error?.message) message = error.message
  } catch {
    // response body wasn't JSON — keep the fallback
  }
  throw new Error(message)
}

export interface CreateMessageTemplateArgs {
  wabaId: string
  accessToken: string
  /** Request body from buildTemplateCreatePayload. */
  payload: Record<string, unknown>
}

export interface MetaCreatedTemplate {
  id: string
  status: string
  category?: string
}

/**
 * Submit a template for Meta's review. It comes back PENDING; the result
 * arrives later on the message_template_status_update webhook.
 *
 * @see https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates
 */
export async function createMessageTemplate(
  args: CreateMessageTemplateArgs,
): Promise<MetaCreatedTemplate> {
  const { wabaId, accessToken, payload } = args
  const response = await fetch(`${META_API_BASE}/${wabaId}/message_templates`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    await throwMetaTemplateError(response, `Template submission failed: ${response.status}`)
  }
  const data = await response.json()
  if (!data.id) throw new Error('Template ID not found in Meta response')
  return { id: String(data.id), status: String(data.status ?? 'PENDING'), category: data.category }
}

export interface GetTokenAppIdArgs {
  accessToken: string
}

/**
 * The Meta app a token belongs to, needed for the Resumable Upload API.
 *
 * @see https://developers.facebook.com/docs/graph-api/reference/debug_token
 */
export async function getTokenAppId(args: GetTokenAppIdArgs): Promise<string> {
  const { accessToken } = args
  const params = new URLSearchParams({ input_token: accessToken })
  const response = await fetch(`${META_API_BASE}/debug_token?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Could not read the Meta app ID: ${response.status}`)
  }
  const data = await response.json()
  const appId = data?.data?.app_id
  if (!appId) throw new Error('Meta app ID not found for this access token')
  return String(appId)
}

export interface UploadTemplateSampleArgs {
  appId: string
  accessToken: string
  file: Blob
  filename: string
  /** image/jpeg, image/png, video/mp4 or application/pdf. */
  mimeType: string
}

/**
 * Upload a sample photo, video or PDF for a media-header template with the
 * Resumable Upload API and return the handle that goes in
 * `example.header_handle`. This is not the same as uploadMedia: a media ID
 * from /media is rejected when creating a template.
 *
 * @see https://developers.facebook.com/docs/graph-api/guides/upload
 */
export async function uploadTemplateSample(
  args: UploadTemplateSampleArgs,
): Promise<{ handle: string }> {
  const { appId, accessToken, file, filename, mimeType } = args
  const bytes = await file.arrayBuffer()

  const params = new URLSearchParams({
    file_name: filename,
    file_length: String(bytes.byteLength),
    file_type: mimeType,
  })
  const session = await fetch(`${META_API_BASE}/${appId}/uploads?${params}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!session.ok) {
    await throwMetaError(session, `Sample upload failed to start: ${session.status}`)
  }
  const sessionId = (await session.json())?.id
  if (typeof sessionId !== 'string' || !sessionId.startsWith('upload:')) {
    throw new Error('Upload session ID not found in Meta response')
  }

  // This step must use "OAuth", not "Bearer", and the raw bytes as the body.
  const upload = await fetch(`${META_API_BASE}/${sessionId}`, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${accessToken}`,
      file_offset: '0',
      'Content-Type': mimeType,
    },
    body: bytes,
  })
  if (!upload.ok) {
    await throwMetaError(upload, `Sample upload failed: ${upload.status}`)
  }
  const handle = (await upload.json())?.h
  if (typeof handle !== 'string' || !handle) throw new Error('File handle not found in Meta response')
  return { handle }
}
