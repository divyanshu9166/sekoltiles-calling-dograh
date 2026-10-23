import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth-helpers'

export async function GET(request: Request) {
    try {
        const session = await getSession()
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { searchParams } = new URL(request.url)
        const contactId = String(searchParams.get('contact_id') ?? '').trim()

        const userId = String(session.user.id)

        if (contactId) {
            const conversation = await prisma.waConversation.findFirst({
                where: { contact_id: contactId, user_id: userId },
                orderBy: { last_message_at: 'desc' },
            })

            return NextResponse.json({ data: conversation })
        }

        const conversations = await prisma.waConversation.findMany({
            where: { user_id: userId },
            include: { contact: true },
            orderBy: [{ last_message_at: 'desc' }, { created_at: 'desc' }],
        })

        return NextResponse.json({ data: conversations })
    } catch (error) {
        console.error('Error loading conversations:', error)
        return NextResponse.json({ error: 'Failed to load conversations' }, { status: 500 })
    }
}
