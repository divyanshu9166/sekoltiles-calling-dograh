import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = String(session.id)
    
    const params = await context.params
    const id = params.id

    // findFirst (not findUnique) because user_id is not part of a @@unique
    // constraint — it's only @@index. Prisma rejects findUnique with a
    // non-unique field in the where clause, throwing a runtime error that
    // the client sees as "Failed to load broadcast".
    const broadcast = await prisma.waBroadcast.findFirst({
      where: { id, user_id: userId }
    })
    
    if (!broadcast) {
      return NextResponse.json({ error: 'Broadcast not found' }, { status: 404 })
    }

    const recipients = await prisma.waBroadcastRecipient.findMany({
      where: { broadcast_id: id },
      orderBy: { created_at: 'desc' },
      include: {
        contact: true
      }
    })

    return NextResponse.json({ broadcast, recipients })
  } catch (error) {
    console.error('Error fetching broadcast:', error)
    return NextResponse.json({ error: 'Failed to fetch broadcast' }, { status: 500 })
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = String(session.id)
    
    const params = await context.params
    const id = params.id

    await prisma.waBroadcast.delete({
      where: { id, user_id: userId }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting broadcast:', error)
    return NextResponse.json({ error: 'Failed to delete broadcast' }, { status: 500 })
  }
}