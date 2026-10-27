import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth-helpers'
import { decrypt } from '@/lib/whatsapp/encryption'
import { uploadMedia } from '@/lib/whatsapp/meta-api'
import { checkTemplateHeaderMedia } from '@/lib/whatsapp/outbound-media'
import { humanReadableMetaError } from '@/lib/whatsapp/phone-utils'
import { isMediaHeaderType } from '@/lib/whatsapp/template-header'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * Uploads the photo, video or PDF for a template's media header and returns
 * Meta's media ID. A broadcast uploads once and reuses the ID for every
 * recipient; Meta keeps it for 30 days.
 */
export async function POST(request: Request) {
  const session = await getSession()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = String(session.user.id)

  const limit = checkRateLimit(`media-upload:${userId}`, RATE_LIMITS.send)
  if (!limit.success) return rateLimitResponse(limit)

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid file upload' }, { status: 400 })
  }

  const headerType = form.get('header_type')
  if (!isMediaHeaderType(headerType)) {
    return NextResponse.json({ error: 'header_type must be image, video or document' }, { status: 400 })
  }
  const file = form.get('file')
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 })
  }
  const name = file instanceof File ? file.name : 'file'
  const check = checkTemplateHeaderMedia(headerType, { name, type: file.type, size: file.size })
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 400 })
  }

  const config = await prisma.waWhatsappConfig.findUnique({ where: { user_id: userId } })
  if (!config) {
    return NextResponse.json(
      { error: 'WhatsApp not configured. Please set up your WhatsApp integration first.' },
      { status: 400 },
    )
  }

  try {
    const { mediaId } = await uploadMedia({
      phoneNumberId: config.phone_number_id,
      accessToken: decrypt(config.access_token),
      file,
      filename: check.filename,
      mimeType: check.mimeType,
    })
    return NextResponse.json({ id: mediaId, type: headerType, filename: check.filename })
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : 'Unknown Meta API error'
    console.error('[whatsapp/media/upload] Meta upload failed:', rawMessage)
    return NextResponse.json({ error: humanReadableMetaError(rawMessage) }, { status: 502 })
  }
}
