import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth-helpers'

function serializeContact(contact: {
    id: string
    user_id: string
    phone: string
    name: string | null
    email: string | null
    company: string | null
    avatar_url: string | null
    created_at: Date
    updated_at: Date
    contact_tags?: Array<{ tag: { id: string; name: string; color: string } }>
}) {
    return {
        id: contact.id,
        user_id: contact.user_id,
        phone: contact.phone,
        name: contact.name,
        email: contact.email,
        company: contact.company,
        avatar_url: contact.avatar_url,
        created_at: contact.created_at.toISOString(),
        updated_at: contact.updated_at.toISOString(),
        tags: contact.contact_tags?.map((ct) => ct.tag) ?? [],
    }
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

        const id = String((await params).id ?? '').trim()
        if (!id) {
            return NextResponse.json({ error: 'Contact id is required' }, { status: 400 })
        }

        const userId = String(session.user.id)

        const contact = await prisma.waContact.findFirst({
            where: { id, user_id: userId },
            include: { contact_tags: { include: { tag: true } } },
        })

        if (!contact) {
            return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
        }

        return NextResponse.json({
            data: serializeContact(contact),
            tag_ids: contact.contact_tags.map((ct) => ct.tag_id),
        })
    } catch (error) {
        console.error('Error loading WA contact:', error)
        return NextResponse.json({ error: 'Failed to load contact' }, { status: 500 })
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

        const id = String((await params).id ?? '').trim()
        if (!id) {
            return NextResponse.json({ error: 'Contact id is required' }, { status: 400 })
        }

        let body: {
            name?: string
            phone?: string
            email?: string
            company?: string
            tag_ids?: string[]
        }

        try {
            body = await request.json()
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
        }

        const userId = String(session.user.id)

        const contact = await prisma.waContact.findFirst({
            where: { id, user_id: userId },
            select: { id: true },
        })

        if (!contact) {
            return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
        }

        const updates: Record<string, unknown> = {}
        if (body?.name !== undefined) {
            updates.name = String(body.name ?? '').trim() || null
        }
        if (body?.phone !== undefined) {
            const phone = String(body.phone ?? '').trim()
            if (!phone) {
                return NextResponse.json({ error: 'Phone number is required' }, { status: 400 })
            }
            updates.phone = phone
        }
        if (body?.email !== undefined) {
            updates.email = String(body.email ?? '').trim() || null
        }
        if (body?.company !== undefined) {
            updates.company = String(body.company ?? '').trim() || null
        }

        await prisma.$transaction(async (tx) => {
            if (Object.keys(updates).length > 0) {
                await tx.waContact.update({
                    where: { id },
                    data: updates,
                })
            }

            if (Array.isArray(body?.tag_ids)) {
                const tagIds = body.tag_ids
                const allowedTags = await tx.waTag.findMany({
                    where: {
                        id: { in: tagIds },
                        user_id: userId,
                    },
                    select: { id: true },
                })

                await tx.waContactTag.deleteMany({ where: { contact_id: id } })

                if (allowedTags.length > 0) {
                    await tx.waContactTag.createMany({
                        data: allowedTags.map((t) => ({
                            contact_id: id,
                            tag_id: t.id,
                        })),
                    })
                }
            }
        })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error updating WA contact:', error)
        return NextResponse.json({ error: 'Failed to update contact' }, { status: 500 })
    }
}

export async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const session = await getSession()
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const id = String((await params).id ?? '').trim()
        if (!id) {
            return NextResponse.json({ error: 'Contact id is required' }, { status: 400 })
        }

        const userId = String(session.user.id)

        const result = await prisma.waContact.deleteMany({
            where: { id, user_id: userId },
        })

        if (result.count === 0) {
            return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
        }

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting WA contact:', error)
        return NextResponse.json({ error: 'Failed to delete contact' }, { status: 500 })
    }
}
