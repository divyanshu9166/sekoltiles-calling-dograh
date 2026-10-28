// Values a template needs at send time besides its body variables: the
// {{1}} in a text header, a location header's pin, the suffix for a website
// button ending in {{1}}, and the code a Copy offer code button copies. They
// are the same for every recipient of a send. Pure, so the inbox picker,
// the broadcast wizard and the server all apply the same rules.

import type { TemplateComponentParams } from '@/lib/whatsapp/meta-api'
import { parseStoredButtons, TEMPLATE_LIMITS, variableCount } from '@/lib/whatsapp/template-submission'

/** A location pin as typed into a form: coordinates may still be text. */
export interface TemplateLocationInput {
  latitude?: number | string
  longitude?: number | string
  name?: string
  address?: string
}

export interface TemplateSendExtras {
  headerText?: string
  location?: TemplateLocationInput
  /** Suffix for each website button ending in {{1}}, by button position. */
  urlSuffixes?: Record<number, string>
  couponCode?: string
}

export interface TemplateSendNeeds {
  headerText: boolean
  location: boolean
  urlButtons: Array<{ index: number; text: string; url: string }>
  /** Position of the Copy offer code button, or null. */
  copyCodeIndex: number | null
}

export interface TemplateShape {
  header_type?: string | null
  header_content?: string | null
  buttons?: unknown
}

export function templateSendNeeds(template: TemplateShape): TemplateSendNeeds {
  const buttons = parseStoredButtons(template.buttons)
  const copyCodeIndex = buttons.findIndex((b) => b.type === 'COPY_CODE')
  return {
    headerText: template.header_type === 'text' && variableCount(template.header_content) > 0,
    location: template.header_type === 'location',
    urlButtons: buttons.flatMap((b, index) =>
      b.type === 'URL' && variableCount(b.url) > 0 ? [{ index, text: b.text, url: b.url ?? '' }] : [],
    ),
    copyCodeIndex: copyCodeIndex >= 0 ? copyCodeIndex : null,
  }
}

export function hasSendNeeds(needs: TemplateSendNeeds) {
  return needs.headerText || needs.location || needs.urlButtons.length > 0 || needs.copyCodeIndex !== null
}

/** Latitude/longitude typed by a person, e.g. "22.8173". */
export function parseCoordinate(value: unknown, max: number): number | null {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim())
  return Number.isFinite(n) && Math.abs(n) <= max && String(value ?? '').trim() !== '' ? n : null
}

/** First problem with the extras for this template, or null when complete. */
export function sendExtrasProblem(needs: TemplateSendNeeds, extras: TemplateSendExtras): string | null {
  if (needs.headerText && !extras.headerText?.trim()) return 'Fill in the header value for {{1}}.'
  if (needs.location) {
    const loc = extras.location
    if (!loc || parseCoordinate(loc.latitude, 90) === null || parseCoordinate(loc.longitude, 180) === null) {
      return 'Enter the location’s latitude and longitude (e.g. 22.8173, 70.8378).'
    }
  }
  for (const button of needs.urlButtons) {
    if (!extras.urlSuffixes?.[button.index]?.trim()) return `Fill in the end of the link for “${button.text}”.`
  }
  if (needs.copyCodeIndex !== null) {
    const code = extras.couponCode?.trim() ?? ''
    if (!code) return 'Enter the offer code customers will copy.'
    if (code.length > TEMPLATE_LIMITS.copyCode) return `The offer code can be at most ${TEMPLATE_LIMITS.copyCode} characters.`
  }
  return null
}

/**
 * Validates extras sent by a client against the template. Returns only the
 * values the template uses, or an error message.
 */
export function parseSendExtras(
  template: TemplateShape,
  value: unknown,
): { ok: true; extras: TemplateSendExtras } | { ok: false; error: string } {
  const needs = templateSendNeeds(template)
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const extras: TemplateSendExtras = {}
  if (needs.headerText) extras.headerText = String(raw.headerText ?? '').trim().slice(0, TEMPLATE_LIMITS.headerText)
  if (needs.location) {
    const loc = (raw.location && typeof raw.location === 'object' ? raw.location : {}) as Record<string, unknown>
    const latitude = parseCoordinate(loc.latitude, 90)
    const longitude = parseCoordinate(loc.longitude, 180)
    if (latitude !== null && longitude !== null) {
      const name = String(loc.name ?? '').trim().slice(0, 100)
      const address = String(loc.address ?? '').trim().slice(0, 300)
      extras.location = { latitude, longitude, ...(name ? { name } : {}), ...(address ? { address } : {}) }
    }
  }
  if (needs.urlButtons.length) {
    const suffixes = (raw.urlSuffixes && typeof raw.urlSuffixes === 'object' ? raw.urlSuffixes : {}) as Record<string, unknown>
    extras.urlSuffixes = {}
    for (const button of needs.urlButtons) {
      const suffix = String(suffixes[button.index] ?? '').trim().slice(0, TEMPLATE_LIMITS.url)
      if (suffix) extras.urlSuffixes[button.index] = suffix
    }
  }
  if (needs.copyCodeIndex !== null) extras.couponCode = String(raw.couponCode ?? '').trim()
  const problem = sendExtrasProblem(needs, extras)
  return problem ? { ok: false, error: problem } : { ok: true, extras }
}

export type SendExtrasParams = Pick<TemplateComponentParams, 'header' | 'headerLocation' | 'buttons'>

/**
 * Reads the header/button parameters stored on a broadcast
 * (broadcasts.template_extras). Anything malformed is dropped.
 */
export function parseStoredSendParams(value: unknown): SendExtrasParams {
  if (!value || typeof value !== 'object') return {}
  const raw = value as Record<string, unknown>
  const params: SendExtrasParams = {}
  if (Array.isArray(raw.header) && typeof raw.header[0] === 'string') params.header = [raw.header[0]]
  const loc = raw.headerLocation as Record<string, unknown> | undefined
  if (loc && typeof loc === 'object') {
    const latitude = parseCoordinate(loc.latitude, 90)
    const longitude = parseCoordinate(loc.longitude, 180)
    if (latitude !== null && longitude !== null) {
      params.headerLocation = {
        latitude,
        longitude,
        ...(typeof loc.name === 'string' && loc.name ? { name: loc.name } : {}),
        ...(typeof loc.address === 'string' && loc.address ? { address: loc.address } : {}),
      }
    }
  }
  if (Array.isArray(raw.buttons)) {
    const buttons = raw.buttons.flatMap((b) => {
      const button = b as Record<string, unknown>
      const index = Number(button?.index)
      const subType = button?.sub_type
      if (!Number.isInteger(index) || index < 0 || index > 9) return []
      if ((subType !== 'url' && subType !== 'copy_code') || typeof button.value !== 'string') return []
      return [{ index, sub_type: subType as 'url' | 'copy_code', value: button.value }]
    })
    if (buttons.length) params.buttons = buttons
  }
  return params
}

/** The header/button parts of the send request for these extras. */
export function sendExtrasComponentParams(
  template: TemplateShape,
  extras: TemplateSendExtras | null | undefined,
): SendExtrasParams {
  if (!extras) return {}
  const needs = templateSendNeeds(template)
  const params: SendExtrasParams = {}
  if (needs.headerText && extras.headerText) params.header = [extras.headerText]
  if (needs.location && extras.location) {
    const latitude = parseCoordinate(extras.location.latitude, 90)
    const longitude = parseCoordinate(extras.location.longitude, 180)
    if (latitude !== null && longitude !== null) {
      const { name, address } = extras.location
      params.headerLocation = { latitude, longitude, ...(name ? { name } : {}), ...(address ? { address } : {}) }
    }
  }
  const buttons: NonNullable<TemplateComponentParams['buttons']> = []
  for (const button of needs.urlButtons) {
    const suffix = extras.urlSuffixes?.[button.index]
    if (suffix) buttons.push({ index: button.index, sub_type: 'url', value: suffix })
  }
  if (needs.copyCodeIndex !== null && extras.couponCode) {
    buttons.push({ index: needs.copyCodeIndex, sub_type: 'copy_code', value: extras.couponCode })
  }
  if (buttons.length) params.buttons = buttons.sort((a, b) => a.index - b.index)
  return params
}
