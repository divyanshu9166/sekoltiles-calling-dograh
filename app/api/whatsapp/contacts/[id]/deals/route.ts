import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth-helpers'

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

        const deals = await prisma.waDeal.findMany({
            where: { contact_id: contactId, user_id: userId },
            include: { stage: true },
            orderBy: { created_at: 'desc' },
        })

        return NextResponse.json({ data: deals })
    } catch (error) {
        console.error('Error loading contact deals:', error)
        return NextResponse.json({ error: 'Failed to load deals' }, { status: 500 })
    }
}
