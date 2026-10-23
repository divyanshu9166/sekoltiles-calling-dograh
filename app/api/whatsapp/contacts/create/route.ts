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
    }
}

export async function POST(request: Request) {
    try {
        const session = await getSession()
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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

        const phone = String(body?.phone ?? '').trim()
        if (!phone) {
            return NextResponse.json({ error: 'Phone number is required' }, { status: 400 })
        }

        const userId = String(session.user.id)

        const contact = await prisma.waContact.create({
            data: {
                user_id: userId,
                phone,
                name: String(body?.name ?? '').trim() || null,
                email: String(body?.email ?? '').trim() || null,
                company: String(body?.company ?? '').trim() || null,
            },
        })

        const tagIds = Array.isArray(body?.tag_ids) ? body.tag_ids : []
        if (tagIds.length > 0) {
            const allowedTags = await prisma.waTag.findMany({
                where: {
                    id: { in: tagIds },
                    user_id: userId,
                },
                select: { id: true },
            })

            if (allowedTags.length > 0) {
                await prisma.waContactTag.createMany({
                    data: allowedTags.map((t) => ({
                        contact_id: contact.id,
                        tag_id: t.id,
                    })),
                })
            }
        }

        return NextResponse.json({ data: serializeContact(contact) })
    } catch (error) {
        console.error('Error creating WA contact:', error)
        return NextResponse.json({ error: 'Failed to create contact' }, { status: 500 })
    }
}
