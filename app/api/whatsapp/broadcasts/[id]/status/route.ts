import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { recalculateBroadcastStats } from '@/lib/whatsapp/broadcast-stats'

const BROADCAST_STATUSES = new Set(['draft', 'scheduled', 'sending', 'sent', 'failed'])

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = String(session.id)
    
    const { id } = await params
    const { status } = await request.json()

    if (!BROADCAST_STATUSES.has(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    const broadcast = await prisma.waBroadcast.findFirst({
      where: { id, user_id: userId }
    })

    if (!broadcast) {
      return NextResponse.json({ error: 'Broadcast not found' }, { status: 404 })
    }

    await prisma.waBroadcast.update({
      where: { id },
      data: { status }
    })

    const stats = await recalculateBroadcastStats(id)

    return NextResponse.json({ ok: true, stats })
  } catch (error) {
    console.error('Error updating broadcast status:', error)
    return NextResponse.json({ error: 'Failed to update broadcast status' }, { status: 500 })
  }
}
