import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth-helpers'

function serializeField(field: {
    id: string
    user_id: string
    field_name: string
    field_type: string
    field_options: unknown
    created_at: Date
}) {
    return {
        id: field.id,
        user_id: field.user_id,
        field_name: field.field_name,
        field_type: field.field_type,
        field_options: field.field_options,
        created_at: field.created_at.toISOString(),
    }
}

async function ensureContact(userId: string, contactId: string) {
    return prisma.waContact.findFirst({
        where: { id: contactId, user_id: userId },
        select: { id: true },
    })
}

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const session = await getSession()
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const contactId = String((await params).id ?? '').trim()
        if (!contactId) {
            return NextResponse.json({ error: 'Contact id is required' }, { status: 400 })
        }

        const userId = String(session.user.id)
        const contact = await ensureContact(userId, contactId)
        if (!contact) {
            return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
        }

        const [fields, values] = await Promise.all([
            prisma.waCustomField.findMany({
                where: { user_id: userId },
                orderBy: { field_name: 'asc' },
            }),
            prisma.waContactCustomValue.findMany({
                where: { contact_id: contactId },
            }),
        ])

        const valueMap: Record<string, string> = {}
        for (const value of values) {
            valueMap[value.custom_field_id] = value.value ?? ''
        }

        return NextResponse.json({
            fields: fields.map(serializeField),
            values: valueMap,
        })
    } catch (error) {
        console.error('Error loading contact custom values:', error)
        return NextResponse.json({ error: 'Failed to load custom values' }, { status: 500 })
    }
}

export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const session = await getSession()
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const contactId = String((await params).id ?? '').trim()
        if (!contactId) {
            return NextResponse.json({ error: 'Contact id is required' }, { status: 400 })
        }

        let body: { values?: Record<string, string> }
        try {
            body = await request.json()
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
        }

        const userId = String(session.user.id)
        const contact = await ensureContact(userId, contactId)
        if (!contact) {
            return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
        }

        const fields = await prisma.waCustomField.findMany({
            where: { user_id: userId },
            select: { id: true },
        })

        const allowedFieldIds = new Set(fields.map((f) => f.id))
        const values = body?.values ?? {}

        const rows = Object.entries(values)
            .map(([fieldId, value]) => ({
                fieldId,
                value: String(value ?? '').trim(),
            }))
            .filter((row) => row.value && allowedFieldIds.has(row.fieldId))

        await prisma.$transaction(async (tx) => {
            await tx.waContactCustomValue.deleteMany({
                where: { contact_id: contactId },
            })

            if (rows.length > 0) {
                await tx.waContactCustomValue.createMany({
                    data: rows.map((row) => ({
                        contact_id: contactId,
                        custom_field_id: row.fieldId,
                        value: row.value,
                    })),
                })
            }
        })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error saving contact custom values:', error)
        return NextResponse.json({ error: 'Failed to save custom values' }, { status: 500 })
    }
}
