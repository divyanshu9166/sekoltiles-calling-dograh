// Builds the request body for submitting a message template to Meta for
// review (POST /{waba-id}/message_templates). Pure, so the settings dialog can
// run the same checks before the request leaves the browser.
//
// Only positional variables ({{1}}, {{2}}) are supported, because that is all
// the inbox and broadcast senders fill in.
//
// @see https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components

export const TEMPLATE_LIMITS = {
  name: 512,
  headerText: 60,
  body: 1024,
  footer: 60,
  buttonText: 25,
  url: 2000,
  phoneNumber: 20,
  buttons: 10,
  urlButtons: 2,
  phoneButtons: 1,
  /** Call on WhatsApp label; Meta defaults it to "Call Now". */
  voiceCallText: 20,
  /** The code a Copy offer code button copies. */
  copyCode: 20,
} as const

export type TemplateSubmitCategory = 'MARKETING' | 'UTILITY'
export type TemplateHeaderMediaFormat = 'IMAGE' | 'VIDEO' | 'DOCUMENT'

/**
 * Button types the CRM can create, named as in WhatsApp Manager:
 * QUICK_REPLY "Custom", URL "Visit website", PHONE_NUMBER "Call phone number",
 * VOICE_CALL "Call on WhatsApp", FLOW "Complete flow", COPY_CODE "Copy offer
 * code", REQUEST_CONTACT_INFO "Share contact info".
 */
export const TEMPLATE_BUTTON_TYPES = [
  'QUICK_REPLY',
  'URL',
  'PHONE_NUMBER',
  'VOICE_CALL',
  'FLOW',
  'COPY_CODE',
  'REQUEST_CONTACT_INFO',
] as const

export type TemplateButtonType = (typeof TEMPLATE_BUTTON_TYPES)[number]

export interface TemplateButtonInput {
  type: TemplateButtonType
  /** Label. COPY_CODE has none: WhatsApp shows its own "Copy offer code". */
  text: string
  /** URL buttons. May end in {{1}} for a per-recipient suffix. */
  url?: string
  /**
   * URL: sample suffix for a URL ending in {{1}}.
   * COPY_CODE: the sample offer code (each send passes the real one).
   */
  example?: string
  /** PHONE_NUMBER buttons, with country code. */
  phone_number?: string
  /** FLOW buttons: the Flow's ID from WhatsApp Manager → Flows. */
  flow_id?: string
  /** FLOW buttons: screen to open; Meta defaults to the first screen. */
  navigate_screen?: string
}

export type TemplateHeaderInput =
  | { format: 'TEXT'; text: string; example?: string }
  | { format: TemplateHeaderMediaFormat; handle: string }
  // The pin is chosen at send time; the template only reserves the header.
  | { format: 'LOCATION' }

export interface BuildTemplateCreatePayloadArgs {
  name: string
  language: string
  category: TemplateSubmitCategory
  header?: TemplateHeaderInput | null
  body: string
  /** Sample value for each body variable, {{1}} first. */
  bodyExamples?: string[]
  footer?: string | null
  buttons?: TemplateButtonInput[]
}

export interface TemplateCreatePayload {
  name: string
  language: string
  category: TemplateSubmitCategory
  parameter_format: 'positional'
  components: Record<string, unknown>[]
}

export class TemplateValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TemplateValidationError'
  }
}

const VARIABLE = /\{\{\s*([^{}]*?)\s*\}\}/g
const HAS_VARIABLE = /\{\{[^{}]*\}\}/

/**
 * Positional variable numbers in the order they first appear, e.g.
 * "Hi {{1}}, {{2}} off" → [1, 2]. Throws on named ones like {{name}}.
 */
export function templateVariables(text: string): number[] {
  const seen: number[] = []
  for (const match of text.matchAll(VARIABLE)) {
    const token = match[1]
    if (!/^\d+$/.test(token)) {
      throw new TemplateValidationError(
        `Use numbered variables like {{1}} instead of {{${token}}}.`,
      )
    }
    const n = Number(token)
    if (!seen.includes(n)) seen.push(n)
  }
  return seen
}

/** Writes "{{ 1 }}" as "{{1}}", the only form Meta reads as a variable. */
export function normalizeVariables(text: string): string {
  return text.replace(/\{\{\s*(\d+)\s*\}\}/g, '{{$1}}')
}

/** How many example values a text needs: one per variable, {{1}}..{{n}}. */
export function variableCount(text: string | null | undefined): number {
  if (!text) return 0
  try {
    return templateVariables(text).length
  } catch {
    return 0
  }
}

/** Meta template names allow only lowercase letters, digits and underscores. */
export function toMetaTemplateName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .slice(0, TEMPLATE_LIMITS.name)
}

/** Maps the CRM's TitleCase category; Authentication is not supported here. */
export function toMetaCategory(category: string): TemplateSubmitCategory | null {
  const upper = category.toUpperCase()
  return upper === 'MARKETING' || upper === 'UTILITY' ? upper : null
}

/**
 * Meta's category back in the CRM's TitleCase. Meta may move a Utility
 * template to Marketing when it is submitted; null when it sends none.
 */
export function fromMetaCategory(category: string | null | undefined): 'Marketing' | 'Utility' | 'Authentication' | null {
  switch (String(category ?? '').toUpperCase()) {
    case 'MARKETING':
      return 'Marketing'
    case 'UTILITY':
      return 'Utility'
    case 'AUTHENTICATION':
      return 'Authentication'
    default:
      return null
  }
}

/**
 * Meta rejects variables that first appear out of order, so "Hi {{2}}, order
 * {{1}}" fails even though both numbers exist. `vars` is in order of first
 * appearance (templateVariables); a later repeat of an earlier one is fine.
 */
function checkSequential(label: string, vars: number[]) {
  vars.forEach((n, i) => {
    if (n !== i + 1) {
      throw new TemplateValidationError(
        `${label} variables must appear in order: {{1}} first, then {{2}} and so on (found {{${n}}} where {{${i + 1}}} should be).`,
      )
    }
  })
}

function requireExamples(label: string, count: number, examples: string[] | undefined): string[] {
  const values = (examples ?? []).slice(0, count).map((v) => String(v ?? '').trim())
  for (let i = 0; i < count; i++) {
    if (!values[i]) {
      throw new TemplateValidationError(`Add a sample value for {{${i + 1}}} in the ${label}.`)
    }
  }
  return values
}

function checkLength(label: string, text: string, max: number) {
  if (text.length > max) {
    throw new TemplateValidationError(`${label} can be at most ${max} characters (it has ${text.length}).`)
  }
}

function buildButton(button: TemplateButtonInput, index: number): Record<string, unknown> {
  const label = `Button ${index + 1}`

  // No label to check: WhatsApp always shows "Copy offer code".
  if (button.type === 'COPY_CODE') {
    const code = String(button.example ?? '').trim()
    if (!code) throw new TemplateValidationError(`${label} needs a sample offer code, e.g. DIWALI20.`)
    checkLength(`${label} offer code`, code, TEMPLATE_LIMITS.copyCode)
    if (HAS_VARIABLE.test(code)) throw new TemplateValidationError(`${label} offer code can't contain variables.`)
    return { type: 'COPY_CODE', example: code }
  }

  const text = String(button.text ?? '').trim()
  if (!text) throw new TemplateValidationError(`${label} needs a label.`)
  checkLength(`${label} label`, text, TEMPLATE_LIMITS.buttonText)
  if (HAS_VARIABLE.test(text)) {
    throw new TemplateValidationError(`${label} label can't contain variables.`)
  }

  if (button.type === 'QUICK_REPLY') return { type: 'QUICK_REPLY', text }

  if (button.type === 'VOICE_CALL') {
    checkLength(`${label} label`, text, TEMPLATE_LIMITS.voiceCallText)
    return { type: 'VOICE_CALL', text }
  }

  if (button.type === 'REQUEST_CONTACT_INFO') return { type: 'REQUEST_CONTACT_INFO', text }

  if (button.type === 'FLOW') {
    const flowId = String(button.flow_id ?? '').trim()
    if (!/^\d{5,30}$/.test(flowId)) {
      throw new TemplateValidationError(
        `${label} needs the Flow ID from WhatsApp Manager → Account tools → Flows (a long number).`,
      )
    }
    const screen = String(button.navigate_screen ?? '').trim()
    if (screen && !/^[A-Za-z][A-Za-z0-9_]*$/.test(screen)) {
      throw new TemplateValidationError(`${label} screen name can only use letters, numbers and underscores.`)
    }
    return {
      type: 'FLOW',
      text,
      flow_id: flowId,
      flow_action: 'navigate',
      ...(screen ? { navigate_screen: screen } : {}),
    }
  }

  if (button.type === 'PHONE_NUMBER') {
    const phone = String(button.phone_number ?? '').replace(/[\s()-]/g, '')
    if (!/^\+?\d{6,19}$/.test(phone)) {
      throw new TemplateValidationError(`${label} needs a phone number with country code, e.g. 919512233383.`)
    }
    checkLength(`${label} phone number`, phone, TEMPLATE_LIMITS.phoneNumber)
    return { type: 'PHONE_NUMBER', text, phone_number: phone }
  }

  if (button.type === 'URL') {
    const url = normalizeVariables(String(button.url ?? '').trim())
    if (!/^https?:\/\/\S+$/i.test(url)) {
      throw new TemplateValidationError(`${label} needs a link starting with https://.`)
    }
    checkLength(`${label} link`, url, TEMPLATE_LIMITS.url)
    const vars = templateVariables(url)
    if (vars.length === 0) return { type: 'URL', text, url }
    if (vars.length > 1 || vars[0] !== 1 || !url.endsWith('{{1}}')) {
      throw new TemplateValidationError(`${label} link can only have one variable, {{1}}, at the very end.`)
    }
    const example = String(button.example ?? '').trim()
    if (!example) {
      throw new TemplateValidationError(`Add a sample value for {{1}} in the ${label.toLowerCase()} link.`)
    }
    // The example is just the suffix that replaces {{1}}, as in Meta's
    // components reference ("promo={{1}}" → ["summer2023"]).
    checkLength(`${label} sample value`, example, TEMPLATE_LIMITS.url)
    return { type: 'URL', text, url, example: [example] }
  }

  throw new TemplateValidationError(`${label} has an unknown type.`)
}

function buildButtons(buttons: TemplateButtonInput[]): Record<string, unknown> | null {
  if (buttons.length === 0) return null
  if (buttons.length > TEMPLATE_LIMITS.buttons) {
    throw new TemplateValidationError(`A template can have at most ${TEMPLATE_LIMITS.buttons} buttons.`)
  }
  const urls = buttons.filter((b) => b.type === 'URL').length
  const phones = buttons.filter((b) => b.type === 'PHONE_NUMBER').length
  if (urls > TEMPLATE_LIMITS.urlButtons) {
    throw new TemplateValidationError(`A template can have at most ${TEMPLATE_LIMITS.urlButtons} link buttons.`)
  }
  if (phones > TEMPLATE_LIMITS.phoneButtons) {
    throw new TemplateValidationError('A template can have only one call button.')
  }
  for (const [type, name] of [
    ['COPY_CODE', 'Copy offer code'],
    ['VOICE_CALL', 'Call on WhatsApp'],
    ['FLOW', 'Complete flow'],
    ['REQUEST_CONTACT_INFO', 'Share contact info'],
  ] as const) {
    if (buttons.filter((b) => b.type === type).length > 1) {
      throw new TemplateValidationError(`A template can have only one "${name}" button.`)
    }
  }
  // Quick replies must sit together: QR, QR, URL is fine; QR, URL, QR is not.
  const types = buttons.map((b) => (b.type === 'QUICK_REPLY' ? 'qr' : 'cta'))
  const groups = types.filter((t, i) => i === 0 || t !== types[i - 1]).length
  if (groups > 2) {
    throw new TemplateValidationError('Keep quick-reply buttons next to each other, before or after the link and call buttons.')
  }
  return { type: 'BUTTONS', buttons: buttons.map(buildButton) }
}

/**
 * Checks a template against Meta's rules and returns the create request body.
 * Throws TemplateValidationError with a message fit to show the user.
 */
export function buildTemplateCreatePayload(args: BuildTemplateCreatePayloadArgs): TemplateCreatePayload {
  const name = args.name.trim()
  if (!name) throw new TemplateValidationError('Template name is required.')
  if (!/^[a-z0-9_]+$/.test(name)) {
    throw new TemplateValidationError(
      `Template name "${name}" can only use lowercase letters, numbers and underscores, e.g. ${toMetaTemplateName(name) || 'festive_offer'}.`,
    )
  }
  checkLength('Template name', name, TEMPLATE_LIMITS.name)

  const language = args.language.trim()
  if (!/^[a-z]{2,3}(_[A-Za-z]{2,4})?$/.test(language)) {
    throw new TemplateValidationError(`"${language}" is not a WhatsApp language code. Use one like en_US or hi.`)
  }

  if (args.category !== 'MARKETING' && args.category !== 'UTILITY') {
    throw new TemplateValidationError('Only Marketing and Utility templates can be submitted from here.')
  }

  const components: Record<string, unknown>[] = []

  if (args.header) {
    if (args.header.format === 'TEXT') {
      const text = normalizeVariables(args.header.text.trim())
      if (!text) {
        throw new TemplateValidationError(
          'This template has a text header but no header text. Delete it and create it again with header text, or with no header.',
        )
      }
      checkLength('Header text', text, TEMPLATE_LIMITS.headerText)
      const vars = templateVariables(text)
      if (vars.length > 1) throw new TemplateValidationError('Header text can have only one variable, {{1}}.')
      checkSequential('Header', vars)
      const header: Record<string, unknown> = { type: 'HEADER', format: 'TEXT', text }
      if (vars.length === 1) {
        header.example = { header_text: requireExamples('header', 1, [args.header.example ?? '']) }
      }
      components.push(header)
    } else if (args.header.format === 'LOCATION') {
      components.push({ type: 'HEADER', format: 'LOCATION' })
    } else {
      const handle = args.header.handle.trim()
      if (!handle) throw new TemplateValidationError('Upload a sample file for the header.')
      components.push({ type: 'HEADER', format: args.header.format, example: { header_handle: [handle] } })
    }
  }

  const body = normalizeVariables(args.body.trim())
  if (!body) throw new TemplateValidationError('Body text is required.')
  checkLength('Body text', body, TEMPLATE_LIMITS.body)
  const bodyVars = templateVariables(body)
  checkSequential('Body', bodyVars)
  // Meta answers this with error 2388299, so catch it before the round trip.
  if (/^\{\{[^{}]*\}\}/.test(body) || /\{\{[^{}]*\}\}$/.test(body)) {
    throw new TemplateValidationError("Meta rejects a body that starts or ends with a variable. Add some text before or after it.")
  }
  const bodyComponent: Record<string, unknown> = { type: 'BODY', text: body }
  if (bodyVars.length > 0) {
    bodyComponent.example = { body_text: [requireExamples('body', bodyVars.length, args.bodyExamples)] }
  }
  components.push(bodyComponent)

  const footer = args.footer?.trim()
  if (footer) {
    checkLength('Footer text', footer, TEMPLATE_LIMITS.footer)
    if (templateVariables(footer).length > 0) {
      throw new TemplateValidationError("Footer text can't contain variables.")
    }
    components.push({ type: 'FOOTER', text: footer })
  }

  const buttons = buildButtons(args.buttons ?? [])
  if (buttons) components.push(buttons)

  return {
    name,
    language,
    category: args.category,
    parameter_format: 'positional',
    components,
  }
}

/**
 * Reads the buttons stored on a template row (the `buttons` JSON column).
 * Unknown shapes are dropped.
 */
export function parseStoredButtons(value: unknown): TemplateButtonInput[] {
  if (!Array.isArray(value)) return []
  const buttons: TemplateButtonInput[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const b = raw as Record<string, unknown>
    const type = String(b.type ?? '').toUpperCase() as TemplateButtonType
    if (!TEMPLATE_BUTTON_TYPES.includes(type)) continue
    // Meta returns the copy-code sample as a one-item array.
    const example = Array.isArray(b.example) ? b.example[0] : b.example
    buttons.push({
      type,
      text: String(b.text ?? ''),
      ...(typeof b.url === 'string' ? { url: b.url } : {}),
      ...(typeof b.phone_number === 'string' ? { phone_number: b.phone_number } : {}),
      ...(type === 'COPY_CODE' && example != null ? { example: String(example) } : {}),
      ...(b.flow_id != null ? { flow_id: String(b.flow_id) } : {}),
      ...(typeof b.navigate_screen === 'string' ? { navigate_screen: b.navigate_screen } : {}),
    })
  }
  return buttons
}
