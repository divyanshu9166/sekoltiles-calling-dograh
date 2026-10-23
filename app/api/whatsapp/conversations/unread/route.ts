import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

export async function GET() {
  try {
    const session = await getSession()
    if (!session?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = String(session.id)

    // Aggregate the sum of unread_count for all conversations belonging to the user
    const result = await prisma.waConversation.aggregate({
      where: { user_id: userId, unread_count: { gt: 0 } },
      _sum: { unread_count: true },
    })

    const unreadCount = result._sum.unread_count || 0

    return NextResponse.json({ unreadCount })
  } catch (error) {
    console.error('Error fetching unread count:', error)
    return NextResponse.json(
      { error: 'Failed to fetch unread count' },
      { status: 500 }
    )
  }
}
