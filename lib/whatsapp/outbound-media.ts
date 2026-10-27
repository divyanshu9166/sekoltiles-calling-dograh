// Which files the inbox can send, shared by the composer and the send API.
// Types and size caps follow Meta's Cloud API media rules; documents are
// capped below Meta's 100 MB so uploads stay quick through the server.

export type OutboundMediaKind = 'image' | 'document' | 'video' | 'audio'

const MB = 1024 * 1024

export const MEDIA_LIMITS: Record<OutboundMediaKind, number> = {
  image: 5 * MB,
  video: 16 * MB,
  audio: 16 * MB,
  document: 25 * MB,
}

const IMAGE_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
}

// WhatsApp plays MP4/3GP video with H.264 video and AAC audio.
const VIDEO_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  '3gp': 'video/3gpp',
}

const AUDIO_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  amr: 'audio/amr',
  ogg: 'audio/ogg',
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

const TYPES_BY_KIND: Record<OutboundMediaKind, Record<string, string>> = {
  image: IMAGE_TYPES,
  video: VIDEO_TYPES,
  audio: AUDIO_TYPES,
  document: DOCUMENT_TYPES,
}

const KIND_LABEL: Record<OutboundMediaKind, string> = {
  image: 'Photos',
  video: 'Videos',
  audio: 'Audio files',
  document: 'Documents',
}

/** Value for the file picker's `accept` attribute. */
export const MEDIA_ACCEPT = [
  ...new Set(Object.values(IMAGE_TYPES)),
  ...Object.keys(VIDEO_TYPES).map((ext) => `.${ext}`),
  ...Object.keys(AUDIO_TYPES).map((ext) => `.${ext}`),
  ...Object.keys(DOCUMENT_TYPES).map((ext) => `.${ext}`),
].join(',')

/** Caption limit Meta applies to image, video and document captions. Audio has none. */
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
  const kind = (Object.keys(TYPES_BY_KIND) as OutboundMediaKind[]).find((k) => TYPES_BY_KIND[k][ext]) ?? null

  if (!kind) {
    return {
      ok: false,
      error:
        'WhatsApp can send JPG or PNG photos, MP4 videos, MP3/M4A/AAC/OGG/AMR audio and PDF, Word, Excel, PowerPoint or TXT files.',
    }
  }
  if (file.size <= 0) return { ok: false, error: 'This file is empty.' }
  if (file.size > MEDIA_LIMITS[kind]) {
    return {
      ok: false,
      error: `${KIND_LABEL[kind]} can be at most ${formatMb(MEDIA_LIMITS[kind])}.`,
    }
  }

  return { ok: true, kind, mimeType: TYPES_BY_KIND[kind][ext], filename }
}

/** Text stored on the message row, matching how inbound media is stored. */
export function mediaMessageText(kind: OutboundMediaKind, filename: string, caption?: string | null) {
  const text = caption?.trim()
  if (kind === 'audio') return null
  if (kind === 'image' || kind === 'video') return text || null
  return text || filename
}

/** Inbox list preview for a sent file. */
export function mediaPreviewText(kind: OutboundMediaKind, filename: string, caption?: string | null) {
  const text = caption?.trim()
  if (kind === 'image') return `📷 ${text || 'Photo'}`
  if (kind === 'video') return `🎬 ${text || 'Video'}`
  if (kind === 'audio') return '🎵 Audio'
  return `📄 ${text || filename}`
}

/** File types a template header accepts, by header format. */
export const TEMPLATE_HEADER_KINDS: Record<'image' | 'video' | 'document', OutboundMediaKind> = {
  image: 'image',
  video: 'video',
  document: 'document',
}

/**
 * Checks a file for a template's media header. Meta only takes JPG/PNG for
 * image headers, MP4 for video headers and PDF for document headers.
 */
export function checkTemplateHeaderMedia(
  headerType: 'image' | 'video' | 'document',
  file: { name: string; type?: string; size: number },
): MediaCheck {
  const check = checkOutboundMedia(file)
  if (!check.ok) return check
  const wrongType =
    check.kind !== TEMPLATE_HEADER_KINDS[headerType] ||
    (headerType === 'video' && check.mimeType !== 'video/mp4') ||
    (headerType === 'document' && check.mimeType !== 'application/pdf')
  if (wrongType) {
    const expected = headerType === 'image' ? 'a JPG or PNG photo' : headerType === 'video' ? 'an MP4 video' : 'a PDF'
    return { ok: false, error: `This template's header needs ${expected}.` }
  }
  return check
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < MB) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / MB).toFixed(1)} MB`
}
