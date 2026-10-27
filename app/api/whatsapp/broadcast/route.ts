import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { parseHeaderMedia } from '@/lib/whatsapp/template-header'
import { appendLog } from '@/lib/whatsapp/api-logger'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  normalizePhoneForMetaIndia,
  isValidE164,
  humanReadableMetaError,
} from '@/lib/whatsapp/phone-utils'
import { sendTemplateToPhone } from '@/lib/whatsapp/broadcast-sender'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'

interface BroadcastResult {
  phone: string
  status: 'sent' | 'failed'
  whatsapp_message_id?: string
  error?: string
}

/**
 * Two input shapes are accepted:
 *
 *   NEW (preferred — supports per-recipient variable substitution):
 *     {
 *       recipients: Array<{ phone: string; params: string[] }>,
 *       template_name, template_language
 *     }
 *
 *   LEGACY (all phones receive the same params — kept so existing
 *   callers don't break):
 *     {
 *       phone_numbers: string[],
 *       template_params: string[],
 *       template_name, template_language
 *     }
 *
 * Previous implementation only supported the legacy shape, and the
 * sending hook was forced to ship every batch with `templateParams[0]`
 * — meaning every recipient got contact-0's personalization. The new
 * shape is what actually fixes that.
 */
interface NewRecipient {
  phone: string
  params?: string[]
}

export async function GET() {
  const session = await getSession()
  if (!session?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = String(session.id)

  try {
    const broadcasts = await prisma.waBroadcast.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
    })
    return NextResponse.json({ broadcasts })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch broadcasts'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession()
    if (!session?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = String(session.id)

    // Per-user broadcast budget.
    const limit = checkRateLimit(`broadcast:${userId}`, RATE_LIMITS.broadcast)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }

    const body = await request.json()
    const {
      recipients: newRecipients,
      phone_numbers,
      template_name,
      template_language,
      template_params,
      header_media,
    } = body

    // Photo/video/PDF for a template with a media header, uploaded once
    // through /api/whatsapp/media/upload and reused for every recipient.
    const headerMedia = parseHeaderMedia(header_media)
    if (header_media && !headerMedia) {
      return NextResponse.json({ error: 'header_media is invalid' }, { status: 400 })
    }

    // Normalize to a list of {phone, params} regardless of shape.
    let recipients: NewRecipient[]
    if (Array.isArray(newRecipients) && newRecipients.length > 0) {
      recipients = newRecipients
    } else if (Array.isArray(phone_numbers) && phone_numbers.length > 0) {
      const shared: string[] = Array.isArray(template_params)
        ? template_params
        : []
      recipients = phone_numbers.map((phone: string) => ({
        phone,
        params: shared,
      }))
    } else {
      return NextResponse.json(
        {
          error:
            'Provide either `recipients` (preferred) or `phone_numbers` — must be a non-empty array',
        },
        { status: 400 }
      )
    }

    if (!template_name) {
      return NextResponse.json(
        { error: 'template_name is required' },
        { status: 400 }
      )
    }

    const config = await prisma.waWhatsappConfig.findUnique({
      where: { user_id: userId },
    })

    if (!config) {
      return NextResponse.json(
        { error: 'WhatsApp not configured. Please set up your WhatsApp integration first.' },
        { status: 400 }
      )
    }

    const accessToken = decrypt(config.access_token)

    const results: BroadcastResult[] = []
    let sentCount = 0
    let failedCount = 0

    for (const recipient of recipients) {
      const sanitized = normalizePhoneForMetaIndia(recipient.phone)

      if (!isValidE164(sanitized)) {
        results.push({
          phone: recipient.phone,
          status: 'failed',
          error: 'Invalid phone number format',
        })
        failedCount++
        continue
      }

      // Retries with phone variants on sandbox "not in allowed list" errors.
      let sentMessageId: string | null = null
      let lastError: string | null = null
      try {
        const result = await sendTemplateToPhone(sendTemplateMessage, sanitized, {
          phoneNumberId: config.phone_number_id,
          accessToken,
          templateName: template_name,
          language: template_language || 'en_US',
          ...(headerMedia
            ? { componentParams: { body: recipient.params ?? [], headerMedia } }
            : { params: recipient.params ?? [] }),
        })
        sentMessageId = result.messageId
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Unknown error'
      }

      if (sentMessageId) {
        results.push({
          phone: recipient.phone,
          status: 'sent',
          whatsapp_message_id: sentMessageId,
        })
        sentCount++
        // Log successful send for the debug panel
        void appendLog(userId, {
          type: 'broadcast_send',
          status: 'success',
          phone: recipient.phone,
          messageId: sentMessageId,
          templateName: template_name,
          request: {
            templateName: template_name,
            language: template_language || 'en_US',
            params: recipient.params ?? [],
            to: sanitized,
          },
          response: { messageId: sentMessageId },
        })
      } else {
        const friendlyError = humanReadableMetaError(lastError || 'Unknown error')
        console.error(
          `Failed to send broadcast to ${recipient.phone}:`,
          lastError
        )
        results.push({
          phone: recipient.phone,
          status: 'failed',
          error: friendlyError,
        })
        failedCount++
        // Log failed send for the debug panel
        void appendLog(userId, {
          type: 'broadcast_send',
          status: 'error',
          phone: recipient.phone,
          templateName: template_name,
          request: {
            templateName: template_name,
            language: template_language || 'en_US',
            params: recipient.params ?? [],
            to: sanitized,
          },
          response: { error: lastError },
          errorMessage: friendlyError,
        })
      }
    }

    return NextResponse.json({
      success: true,
      total: recipients.length,
      sent: sentCount,
      failed: failedCount,
      results,
    })
  } catch (error) {
    console.error('Error in WhatsApp broadcast POST:', error)
    return NextResponse.json(
      { error: 'Failed to process broadcast' },
      { status: 500 }
    )
  }
}