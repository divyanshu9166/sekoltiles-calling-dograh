import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

const CATEGORY_VALUES = new Set(['Marketing', 'Utility', 'Authentication'])
const STATUS_VALUES = new Set(['Draft', 'Pending', 'Approved', 'Rejected'])
const HEADER_TYPES = new Set(['text', 'image', 'video', 'document'])

function serializeTemplate(template: {
    id: string
    user_id: string
    name: string
    category: string
    language: string
    header_type: string | null
    header_content: string | null
    body_text: string
    footer_text: string | null
    buttons: unknown
    status: string
    created_at: Date
}) {
    return {
        id: template.id,
        user_id: template.user_id,
        name: template.name,
        category: template.category,
        language: template.language,
        header_type: template.header_type,
        header_content: template.header_content,
        body_text: template.body_text,
        footer_text: template.footer_text,
        buttons: template.buttons,
        status: template.status,
        created_at: template.created_at.toISOString(),
    }
}

export async function GET() {
    const session = await getSession()
    if (!session?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = String(session.id)
    const templates = await prisma.waMessageTemplate.findMany({
        where: { user_id: userId },
        orderBy: { created_at: 'desc' },
    })

    return NextResponse.json({ data: templates.map(serializeTemplate) })
}

export async function POST(request: Request) {
    const session = await getSession()
    if (!session?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body: {
        name?: string
        category?: string
        language?: string
        body_text?: string
        header_type?: string | null
        header_content?: string | null
        footer_text?: string | null
        buttons?: unknown
        status?: string
    }

    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const name = String(body?.name ?? '').trim()
    const bodyText = String(body?.body_text ?? '').trim()
    if (!name) {
        return NextResponse.json({ error: 'Template name is required' }, { status: 400 })
    }
    if (!bodyText) {
        return NextResponse.json({ error: 'Body text is required' }, { status: 400 })
    }

    const category = CATEGORY_VALUES.has(String(body?.category ?? ''))
        ? String(body?.category)
        : 'Marketing'
    // Creating a row locally does not submit it to Meta. Only the Meta sync
    // route can mark a template Approved; this blocks forged local approvals.
    const requestedStatus = STATUS_VALUES.has(String(body?.status ?? ''))
        ? String(body?.status)
        : 'Draft'
    const status = requestedStatus === 'Approved' ? 'Draft' : requestedStatus
    const language = String(body?.language ?? '').trim() || 'en_US'
    const headerTypeRaw = String(body?.header_type ?? '').trim()
    const header_type = HEADER_TYPES.has(headerTypeRaw) ? headerTypeRaw : null
    const header_content =
        typeof body?.header_content === 'string' && body.header_content.trim()
            ? body.header_content.trim()
            : null
    const footer_text =
        typeof body?.footer_text === 'string' && body.footer_text.trim()
            ? body.footer_text.trim()
            : null

    const userId = String(session.id)
    const templateData: {
        user_id: string
        name: string
        category: string
        language: string
        header_type: string | null
        header_content: string | null
        body_text: string
        footer_text: string | null
        buttons?: any
        status: string
    } = {
        user_id: userId,
        name,
        category,
        language,
        header_type,
        header_content,
        body_text: bodyText,
        footer_text,
        status,
    }

    if (body?.buttons !== undefined) {
        templateData.buttons = body.buttons as any
    }

    const created = await prisma.waMessageTemplate.create({
        data: templateData,
    })

    return NextResponse.json({ data: serializeTemplate(created) })
}
