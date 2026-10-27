import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth-helpers'
import { markConversationRead } from '@/lib/whatsapp/read-receipts'

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const session = await getSession()
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const conversationId = String((await params).id ?? '').trim()
        if (!conversationId) {
            return NextResponse.json({ error: 'Conversation id is required' }, { status: 400 })
        }

        let body: {
            status?: string
            assigned_agent_id?: string | null
            unread_count?: number
        }

        try {
            body = await request.json()
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
        }

        const updates: Record<string, unknown> = {}

        if (body?.status !== undefined) {
            updates.status = String(body.status)
        }

        if (body?.assigned_agent_id !== undefined) {
            updates.assigned_agent_id = body.assigned_agent_id
                ? String(body.assigned_agent_id)
                : null
        }

        if (body?.unread_count !== undefined) {
            const count = Number(body.unread_count)
            if (!Number.isFinite(count) || count < 0) {
                return NextResponse.json({ error: 'Invalid unread_count' }, { status: 400 })
            }
            updates.unread_count = count
        }

        if (Object.keys(updates).length === 0) {
            return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
        }

        const userId = String(session.user.id)

        const result = await prisma.waConversation.updateMany({
            where: { id: conversationId, user_id: userId },
            data: updates,
        })

        if (result.count === 0) {
            return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
        }

        // Fetch the updated conversation to broadcast the correct state
        const updatedConv = await prisma.waConversation.findUnique({
            where: { id: conversationId },
        })

        // Opening an unread chat clears the badge; tell WhatsApp too so the
        // customer sees blue ticks.
        if (updates.unread_count === 0) {
            void markConversationRead({ userId, conversationId })
        }

        if (updatedConv) {
            import('@/lib/redis').then(({ publishEvent }) => {
                publishEvent('chat_events', {
                    type: 'conversation_update',
                    userId: updatedConv.user_id,
                    conversationId,
                    payload: updatedConv
                }).catch(() => {})
            })
        }

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error updating conversation:', error)
        return NextResponse.json({ error: 'Failed to update conversation' }, { status: 500 })
    }
}
