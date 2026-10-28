import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth-helpers'
import {
  sendTextMessage,
  sendTemplateMessage,
  uploadMedia,
  sendMediaMessage,
} from '@/lib/whatsapp/meta-api'
import {
  checkOutboundMedia,
  mediaMessageText,
  mediaPreviewText,
  MEDIA_CAPTION_LIMIT,
  type OutboundMediaKind,
} from '@/lib/whatsapp/outbound-media'
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption'
import { parseHeaderMedia } from '@/lib/whatsapp/template-header'
import { parseSendExtras, sendExtrasComponentParams, type TemplateSendExtras } from '@/lib/whatsapp/template-send-extras'
import {
  normalizePhoneForMetaIndia,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
  isRecipientNotRegisteredError,
  humanReadableMetaError,
} from '@/lib/whatsapp/phone-utils'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'

export async function POST(request: Request) {
  try {
    const session = await getSession()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = String(session.user.id)

    // Per-user rate limit. Bucket key is scoped to this route so
    // `/broadcast` has an independent budget.
    const limit = checkRateLimit(`send:${userId}`, RATE_LIMITS.send)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }

    // Files (photos, videos, audio, documents) arrive as multipart/form-data with a `file`;
    // text and template sends stay JSON.
    let conversation_id: string | undefined
    let message_type: string | undefined
    let content_text: string | undefined
    let media_url: string | undefined
    let template_name: string | undefined
    let template_params: string[] | undefined
    let template_language: string | undefined
    let header_media: unknown
    let template_extras: unknown
    let reply_to_message_id: string | undefined
    let upload: { file: Blob; kind: OutboundMediaKind; mimeType: string; filename: string } | null = null

    if ((request.headers.get('content-type') ?? '').includes('multipart/form-data')) {
      let form: FormData
      try {
        form = await request.formData()
      } catch {
        return NextResponse.json({ error: 'Invalid file upload' }, { status: 400 })
      }
      const file = form.get('file')
      if (!(file instanceof Blob)) {
        return NextResponse.json({ error: 'file is required' }, { status: 400 })
      }
      const name = file instanceof File ? file.name : String(form.get('filename') ?? 'file')
      const check = checkOutboundMedia({ name, type: file.type, size: file.size })
      if (!check.ok) {
        return NextResponse.json({ error: check.error }, { status: 400 })
      }
      const caption = String(form.get('caption') ?? '').trim()
      if (check.kind === 'audio' && caption) {
        return NextResponse.json(
          { error: 'WhatsApp sends audio without a caption. Remove the text or send it as a separate message.' },
          { status: 400 }
        )
      }
      if (caption.length > MEDIA_CAPTION_LIMIT) {
        return NextResponse.json(
          { error: `Caption can be at most ${MEDIA_CAPTION_LIMIT} characters` },
          { status: 400 }
        )
      }
      upload = { file, kind: check.kind, mimeType: check.mimeType, filename: check.filename }
      conversation_id = String(form.get('conversation_id') ?? '') || undefined
      message_type = check.kind
      content_text = caption || undefined
      reply_to_message_id = String(form.get('reply_to_message_id') ?? '') || undefined
    } else {
      const body = await request.json()
      ;({
        conversation_id,
        message_type,
        content_text,
        media_url,
        template_name,
        template_params,
        template_language,
        header_media,
        template_extras,
        reply_to_message_id,
      } = body)
    }

    if (!conversation_id || !message_type) {
      return NextResponse.json(
        { error: 'conversation_id and message_type are required' },
        { status: 400 }
      )
    }

    if (message_type === 'text' && !content_text) {
      return NextResponse.json(
        { error: 'content_text is required for text messages' },
        { status: 400 }
      )
    }

    if (message_type === 'template' && !template_name) {
      return NextResponse.json(
        { error: 'template_name is required for template messages' },
        { status: 400 }
      )
    }

    // Photo/video/PDF for a template with a media header (uploaded first
    // through /api/whatsapp/media/upload).
    const headerMedia = message_type === 'template' ? parseHeaderMedia(header_media) : null
    if (message_type === 'template' && header_media && !headerMedia) {
      return NextResponse.json({ error: 'header_media is invalid' }, { status: 400 })
    }

    // Header {{1}}, location pin, link suffixes and offer code, checked
    // against the stored template so the button positions are Meta's.
    let templateExtras: TemplateSendExtras | null = null
    let templateShape: { header_type: string | null; header_content: string | null; buttons: unknown } | null = null
    if (message_type === 'template' && template_name) {
      templateShape = await prisma.waMessageTemplate.findFirst({
        where: { user_id: userId, name: template_name, ...(template_language ? { language: template_language } : {}) },
        select: { header_type: true, header_content: true, buttons: true },
      })
      if (templateShape) {
        const parsed = parseSendExtras(templateShape, template_extras)
        if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
        templateExtras = parsed.extras
      }
    }

    // Fetch conversation and contact
    const conversation = await prisma.waConversation.findFirst({
      where: { id: conversation_id, user_id: userId },
      include: { contact: true },
    })

    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const contact = conversation.contact
    if (!contact?.phone) {
      return NextResponse.json(
        { error: 'Contact phone number not found' },
        { status: 400 }
      )
    }

    // Sanitize and validate phone
    const sanitizedPhone = normalizePhoneForMetaIndia(contact.phone)
    if (!isValidE164(sanitizedPhone)) {
      return NextResponse.json(
        { error: 'Invalid phone number format' },
        { status: 400 }
      )
    }

    // Fetch and decrypt WhatsApp config
    const config = await prisma.waWhatsappConfig.findFirst({
      where: { user_id: userId },
    })

    if (!config) {
      return NextResponse.json(
        { error: 'WhatsApp not configured. Please set up your WhatsApp integration first.' },
        { status: 400 }
      )
    }

    const accessToken = decrypt(config.access_token)

    // Self-heal legacy CBC-encrypted tokens. Fire-and-forget: we
    // return from the send without waiting, so a failed upgrade just
    // means the next send tries again. The upgrade is idempotent —
    // concurrent sends both produce valid GCM ciphertexts of the same
    // plaintext, last write wins.
    if (isLegacyFormat(config.access_token)) {
      void prisma.waWhatsappConfig
        .update({
          where: { id: config.id },
          data: { access_token: encrypt(accessToken) },
        })
        .catch((error) => {
          console.warn(
            '[whatsapp/send] access_token GCM upgrade failed:',
            error instanceof Error ? error.message : error,
          )
        })
    }

    // Send via Meta API — retry with phone-number variants if Meta rejects
    // with "recipient not in allowed list" (common in sandbox / when a
    // number was registered with/without a trunk 0). If an alternate
    // format succeeds, we persist it back to the contact row so the
    // next send goes through on the first attempt.
    let contextMessageId: string | undefined
    if (reply_to_message_id) {
      const parent = await prisma.waMessage.findFirst({
        where: { id: reply_to_message_id, conversation_id },
        select: { message_id: true },
      })

      if (!parent) {
        return NextResponse.json(
          { error: 'reply_to_message_id not found in this conversation' },
          { status: 400 }
        )
      }

      if (!parent.message_id) {
        console.warn(
          '[whatsapp/send] reply target has no Meta message_id; sending without context'
        )
      } else {
        contextMessageId = parent.message_id
      }
    }

    // Upload once, before the phone-variant retries: the media ID isn't tied
    // to a recipient. The stored URL goes through our media proxy, which
    // resolves uploaded IDs the same way as inbound ones.
    let mediaId: string | null = null
    if (upload) {
      try {
        ;({ mediaId } = await uploadMedia({
          phoneNumberId: config.phone_number_id,
          accessToken,
          file: upload.file,
          filename: upload.filename,
          mimeType: upload.mimeType,
        }))
      } catch (err) {
        const rawMessage = err instanceof Error ? err.message : 'Unknown Meta API error'
        console.error('Meta media upload failed:', rawMessage)
        return NextResponse.json({ error: humanReadableMetaError(rawMessage) }, { status: 502 })
      }
      media_url = `/api/whatsapp/media/${mediaId}`
    }

    let waMessageId = ''
    let workingPhone = sanitizedPhone

    const attempt = async (phone: string): Promise<string> => {
      if (upload && mediaId) {
        const result = await sendMediaMessage({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to: phone,
          kind: upload.kind,
          mediaId,
          caption: content_text,
          filename: upload.filename,
          contextMessageId,
        })
        return result.messageId
      }
      if (message_type === 'template') {
        const result = await sendTemplateMessage({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to: phone,
          templateName: template_name ?? '',
          language: template_language || undefined,
          componentParams: {
            body: template_params || [],
            ...(headerMedia ? { headerMedia } : {}),
            ...(templateShape ? sendExtrasComponentParams(templateShape, templateExtras) : {}),
          },
          contextMessageId,
        })
        return result.messageId
      }
      const result = await sendTextMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        text: content_text ?? '',
        contextMessageId,
      })
      return result.messageId
    }

    try {
      const variants = phoneVariants(sanitizedPhone)
      let lastError: unknown = null

      for (const variant of variants) {
        try {
          waMessageId = await attempt(variant)
          workingPhone = variant
          lastError = null
          break
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          // "Account not registered" (#133010) is a sender-side config
          // issue — retrying with phone variants won't help.
          if (isRecipientNotRegisteredError(message)) {
            throw err
          }
          // Only retry when the failure is specifically that the
          // recipient isn't in Meta's allowed list. Any other error
          // (bad token, invalid template, etc.) bubbles up immediately.
          if (!isRecipientNotAllowedError(message)) {
            throw err
          }
          lastError = err
          console.warn(`[whatsapp/send] variant "${variant}" rejected by Meta, trying next…`)
        }
      }

      if (lastError) throw lastError
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : 'Unknown Meta API error'
      const friendlyMessage = humanReadableMetaError(rawMessage)
      console.error('Meta API send failed for all variants:', rawMessage)
      return NextResponse.json(
        { error: friendlyMessage },
        { status: 502 }
      )
    }

    // If a non-original variant succeeded, update the contact so future
    // sends go straight through. sanitizePhoneForMeta on workingPhone
    // will yield workingPhone itself, so re-storing preserves it.
    if (workingPhone !== sanitizedPhone) {
      console.log(
        `[whatsapp/send] Auto-corrected contact phone: ${sanitizedPhone} → ${workingPhone}`
      )
      await prisma.waContact.update({
        where: { id: contact.id },
        data: { phone: workingPhone },
      })
    }

    // Insert message into DB — field names MUST match the messages schema
    // (see supabase/migrations/001_initial_schema.sql):
    //   conversation_id, sender_type, content_type, content_text,
    //   media_url, template_name, message_id, status, created_at
    const messageRecord = await prisma.waMessage.create({
      data: {
        conversation_id,
        sender_type: 'agent',
        sender_id: userId,
        content_type: message_type,
        content_text: upload
          ? mediaMessageText(upload.kind, upload.filename, content_text)
          : content_text || null,
        // Only photo headers are previewed in the inbox bubble.
        media_url: headerMedia?.type === 'image' ? `/api/whatsapp/media/${headerMedia.id}` : media_url || null,
        template_name: template_name || null,
        message_id: waMessageId,
        status: 'sent',
        reply_to_message_id: reply_to_message_id || null,
      },
    })

    // Update conversation
    const updatedConversation = await prisma.waConversation.update({
      where: { id: conversation_id },
      data: {
        last_message_text: upload
          ? mediaPreviewText(upload.kind, upload.filename, content_text)
          : content_text || `[${message_type}]`,
        last_message_at: new Date(),
      },
    })

    import('@/lib/redis').then(({ publishEvent }) => {
      publishEvent('chat_events', {
        type: 'new_message',
        userId,
        conversationId: conversation_id,
        payload: { message: messageRecord }
      }).catch(() => {})
      publishEvent('chat_events', {
        type: 'conversation_update',
        userId,
        conversationId: conversation_id,
        payload: updatedConversation
      }).catch(() => {})
    })

    return NextResponse.json({
      success: true,
      message_id: messageRecord.id,
      whatsapp_message_id: waMessageId,
      media_url: messageRecord.media_url,
      content_text: messageRecord.content_text,
    })
  } catch (error) {
    console.error('Error in WhatsApp send POST:', error)
    return NextResponse.json(
      { error: 'Failed to send message' },
      { status: 500 }
    )
  }
}
