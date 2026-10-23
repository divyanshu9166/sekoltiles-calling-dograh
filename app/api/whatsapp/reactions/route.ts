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
        const conversationId = String(searchParams.get('conversation_id') ?? '').trim()
        if (!conversationId) {
            return NextResponse.json({ error: 'conversation_id is required' }, { status: 400 })
        }

        const userId = String(session.user.id)
        const conversation = await prisma.waConversation.findFirst({
            where: { id: conversationId, user_id: userId },
            select: { id: true },
        })

        if (!conversation) {
            return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
        }

        const reactions = await prisma.waMessageReaction.findMany({
            where: { conversation_id: conversationId },
            orderBy: { created_at: 'asc' },
        })

        return NextResponse.json({ data: reactions })
    } catch (error) {
        console.error('Error loading reactions:', error)
        return NextResponse.json({ error: 'Failed to load reactions' }, { status: 500 })
    }
}
