// Which files the inbox can send, shared by the composer and the send API.
// Types and size caps follow Meta's Cloud API media rules; documents are
// capped below Meta's 100 MB so uploads stay quick through the server.

export type OutboundMediaKind = 'image' | 'document'

const MB = 1024 * 1024

export const MEDIA_LIMITS: Record<OutboundMediaKind, number> = {
  image: 5 * MB,
  document: 25 * MB,
}

const IMAGE_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
}

const DOCUMENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
}

/** Value for the file picker's `accept` attribute. */
export const MEDIA_ACCEPT = [
  ...new Set(Object.values(IMAGE_TYPES)),
  ...Object.keys(DOCUMENT_TYPES).map((ext) => `.${ext}`),
].join(',')

/** Caption limit Meta applies to image and document captions. */
export const MEDIA_CAPTION_LIMIT = 1024

export type MediaCheck =
  | { ok: true; kind: OutboundMediaKind; mimeType: string; filename: string }
  | { ok: false; error: string }

function formatMb(bytes: number) {
  return `${Math.round(bytes / MB)} MB`
}

/**
 * Classifies a file by extension (browsers often report an empty or generic
 * type for Office files) and checks it against Meta's limits.
 */
export function checkOutboundMedia(file: { name: string; type?: string; size: number }): MediaCheck {
  const filename = file.name.trim() || 'file'
  const ext = filename.includes('.') ? filename.split('.').pop()!.toLowerCase() : ''
  const kind: OutboundMediaKind | null = IMAGE_TYPES[ext] ? 'image' : DOCUMENT_TYPES[ext] ? 'document' : null

  if (!kind) {
    return {
      ok: false,
      error: 'WhatsApp can send JPG or PNG photos and PDF, Word, Excel, PowerPoint or TXT files.',
    }
  }
  if (file.size <= 0) return { ok: false, error: 'This file is empty.' }
  if (file.size > MEDIA_LIMITS[kind]) {
    return {
      ok: false,
      error: `${kind === 'image' ? 'Photos' : 'Documents'} can be at most ${formatMb(MEDIA_LIMITS[kind])}.`,
    }
  }

  const mimeType = (kind === 'image' ? IMAGE_TYPES : DOCUMENT_TYPES)[ext]
  return { ok: true, kind, mimeType, filename }
}

/** Text stored on the message row, matching how inbound media is stored. */
export function mediaMessageText(kind: OutboundMediaKind, filename: string, caption?: string | null) {
  const text = caption?.trim()
  if (kind === 'image') return text || null
  return text || filename
}

/** Inbox list preview for a sent file. */
export function mediaPreviewText(kind: OutboundMediaKind, filename: string, caption?: string | null) {
  const text = caption?.trim()
  return kind === 'image' ? `📷 ${text || 'Photo'}` : `📄 ${text || filename}`
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < MB) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / MB).toFixed(1)} MB`
}
