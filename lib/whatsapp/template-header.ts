import type { TemplateHeaderMedia } from '@/lib/whatsapp/meta-api'

/** Media header types a WhatsApp template can have. */
export type TemplateHeaderMediaType = TemplateHeaderMedia['type']

export function isMediaHeaderType(value: unknown): value is TemplateHeaderMediaType {
  return value === 'image' || value === 'video' || value === 'document'
}

/**
 * Validates the `header_media` a client sends with a template: a Meta media
 * ID from /api/whatsapp/media/upload plus the header type.
 */
export function parseHeaderMedia(value: unknown): TemplateHeaderMedia | null {
  if (!value || typeof value !== 'object') return null
  const { type, id, filename } = value as Record<string, unknown>
  if (!isMediaHeaderType(type)) return null
  if (typeof id !== 'string' || !/^[\w-]{1,128}$/.test(id)) return null
  return {
    type,
    id,
    ...(typeof filename === 'string' && filename.trim() ? { filename: filename.trim().slice(0, 240) } : {}),
  }
}
