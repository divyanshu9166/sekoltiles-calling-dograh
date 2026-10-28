import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { decrypt } from '@/lib/whatsapp/encryption'
import { createMessageTemplate, getTokenAppId, uploadTemplateSample } from '@/lib/whatsapp/meta-api'
import { checkTemplateHeaderMedia } from '@/lib/whatsapp/outbound-media'
import { isMediaHeaderType } from '@/lib/whatsapp/template-header'
import { normalizeTemplateStatus } from '@/lib/whatsapp/template-status'
import {
  buildTemplateCreatePayload,
  fromMetaCategory,
  normalizeVariables,
  parseStoredButtons,
  toMetaCategory,
  toMetaTemplateName,
  TemplateValidationError,
  type TemplateHeaderInput,
} from '@/lib/whatsapp/template-submission'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

/**
 * Submits a Draft template to Meta for review.
 *
 * Takes multipart form data (JSON also works when there is no file):
 *   header_example   sample for {{1}} in a text header
 *   body_examples    JSON array, a sample for each body variable
 *   button_examples  JSON array by button position, a sample for a link ending in {{1}}
 *   file             sample photo / MP4 / PDF for a media header
 *
 * On success the row turns Pending with Meta's template ID. Approval or
 * rejection then arrives on the message_template_status_update webhook.
 */

const SUBMIT_LIMIT = { limit: 10, windowMs: 60_000 }

interface SubmitInput {
  headerExample: string
  bodyExamples: string[]
  buttonExamples: string[]
  file: Blob | null
}

function toStringArray(value: unknown): string[] {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return []
    }
  }
  return Array.isArray(value) ? value.map((v) => (v == null ? '' : String(v))) : []
}

async function readInput(request: Request): Promise<SubmitInput | null> {
  const contentType = request.headers.get('content-type') ?? ''
  try {
    if (contentType.includes('application/json')) {
      const body = await request.json()
      return {
        headerExample: String(body?.header_example ?? ''),
        bodyExamples: toStringArray(body?.body_examples),
        buttonExamples: toStringArray(body?.button_examples),
        file: null,
      }
    }
    const form = await request.formData()
    const file = form.get('file')
    return {
      headerExample: String(form.get('header_example') ?? ''),
      bodyExamples: toStringArray(form.get('body_examples')),
      buttonExamples: toStringArray(form.get('button_examples')),
      file: file instanceof Blob && file.size > 0 ? file : null,
    }
  } catch {
    return null
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = String(session.id)

  const limit = checkRateLimit(`template-submit:${userId}`, SUBMIT_LIMIT)
  if (!limit.success) return rateLimitResponse(limit)

  const id = String((await params).id ?? '').trim()
  const template = id
    ? await prisma.waMessageTemplate.findFirst({ where: { id, user_id: userId } })
    : null
  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  }
  if (template.status !== 'Draft' || template.meta_template_id) {
    return NextResponse.json(
      { error: `This template is already ${template.status.toLowerCase()} on Meta. Only drafts can be submitted.` },
      { status: 409 },
    )
  }

  const input = await readInput(request)
  if (!input) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const category = toMetaCategory(template.category)
  if (!category) {
    return NextResponse.json(
      { error: 'Authentication templates need Meta’s one-time-password setup. Create them in WhatsApp Manager, then sync.' },
      { status: 400 },
    )
  }

  const name = toMetaTemplateName(template.name)
  if (name !== template.name) {
    const clash = await prisma.waMessageTemplate.findFirst({
      where: { user_id: userId, name, language: template.language, NOT: { id: template.id } },
      select: { id: true },
    })
    if (clash) {
      return NextResponse.json(
        { error: `Another template is already called ${name} (${template.language}). Rename or delete one of them.` },
        { status: 409 },
      )
    }
  }

  const config = await prisma.waWhatsappConfig.findUnique({ where: { user_id: userId } })
  if (!config) {
    return NextResponse.json(
      { error: 'WhatsApp not configured. Connect your WhatsApp Business account in Settings first.' },
      { status: 400 },
    )
  }
  if (!config.waba_id) {
    return NextResponse.json(
      { error: 'WABA (WhatsApp Business Account) ID missing. Add it in WhatsApp Settings first.' },
      { status: 400 },
    )
  }

  // Media headers need a sample file; check it before anything goes to Meta.
  const headerType = template.header_type
  let sample: { filename: string; mimeType: string } | null = null
  if (isMediaHeaderType(headerType)) {
    if (!input.file) {
      return NextResponse.json({ error: 'Attach a sample file for the header so Meta can review it.' }, { status: 400 })
    }
    const fileName = input.file instanceof File ? input.file.name : 'sample'
    const check = checkTemplateHeaderMedia(headerType, { name: fileName, type: input.file.type, size: input.file.size })
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: 400 })
    }
    sample = { filename: check.filename, mimeType: check.mimeType }
  }

  const buildArgs = (header: TemplateHeaderInput | null) =>
    buildTemplateCreatePayload({
      name,
      language: template.language,
      category,
      header,
      body: template.body_text,
      bodyExamples: input.bodyExamples,
      footer: template.footer_text,
      buttons: parseStoredButtons(template.buttons).map((button, i) =>
        button.type === 'URL' ? { ...button, example: input.buttonExamples[i] ?? '' } : button,
      ),
    })

  const headerFor = (handle: string): TemplateHeaderInput | null => {
    if (headerType === 'text') {
      return { format: 'TEXT', text: template.header_content ?? '', example: input.headerExample }
    }
    if (isMediaHeaderType(headerType)) {
      return { format: headerType.toUpperCase() as 'IMAGE' | 'VIDEO' | 'DOCUMENT', handle }
    }
    if (headerType === 'location') return { format: 'LOCATION' }
    return null
  }

  // Validate first with a stand-in handle so a typo doesn't cost an upload.
  try {
    buildArgs(headerFor('pending-upload'))
  } catch (err) {
    if (err instanceof TemplateValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    throw err
  }

  const accessToken = decrypt(config.access_token)

  let created: Awaited<ReturnType<typeof createMessageTemplate>>
  try {
    let handle = ''
    if (sample && input.file) {
      const appId = process.env.META_APP_ID?.trim() || (await getTokenAppId({ accessToken }))
      ;({ handle } = await uploadTemplateSample({
        appId,
        accessToken,
        file: input.file,
        filename: sample.filename,
        mimeType: sample.mimeType,
      }))
    }

    created = await createMessageTemplate({
      wabaId: config.waba_id,
      accessToken,
      payload: { ...buildArgs(headerFor(handle)) },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown Meta API error'
    console.error('[whatsapp/templates/submit] Meta rejected the submission:', message)
    return NextResponse.json({ error: `Meta did not accept the template: ${message}` }, { status: 502 })
  }

  // Meta has the template now; a failure past this point must not read as a
  // rejection (the New Template form deletes the draft on a 502).
  try {
    const updated = await prisma.waMessageTemplate.update({
      where: { id: template.id },
      data: {
        name,
        // Store what Meta now has: {{ 1 }} written as {{1}}, and Meta's
        // category, which can differ from the one submitted.
        body_text: normalizeVariables(template.body_text.trim()),
        ...(template.header_content
          ? { header_content: normalizeVariables(template.header_content.trim()) }
          : {}),
        category: fromMetaCategory(created.category) ?? template.category,
        status: normalizeTemplateStatus(created.status) === 'Draft' ? 'Pending' : normalizeTemplateStatus(created.status),
        status_reason: null,
        meta_template_id: created.id,
      },
    })

    return NextResponse.json({
      data: {
        id: updated.id,
        name: updated.name,
        status: updated.status,
        meta_template_id: updated.meta_template_id,
        category: updated.category,
      },
    })
  } catch (err) {
    console.error('[whatsapp/templates/submit] Meta accepted the template but saving it failed:', err)
    return NextResponse.json(
      { error: `Meta accepted the template (ID ${created.id}) but saving it here failed. Run "Sync from Meta".` },
      { status: 500 },
    )
  }
}
