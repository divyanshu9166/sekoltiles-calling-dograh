import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth-helpers'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const { needs_human } = await request.json()

    if (typeof needs_human !== 'boolean') {
      return NextResponse.json({ error: 'Invalid needs_human value' }, { status: 400 })
    }

    const conversation = await prisma.waConversation.findUnique({
      where: { id },
      select: { user_id: true }
    })

    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }
    
    if (conversation.user_id !== String(session.user.id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const updated = await prisma.waConversation.update({
      where: { id },
      data: { needs_human }
    })

    return NextResponse.json({ data: updated })
  } catch (error) {
    console.error('Error updating human takeover status:', error)
    return NextResponse.json(
      { error: 'Failed to update status' },
      { status: 500 }
    )
  }
}
