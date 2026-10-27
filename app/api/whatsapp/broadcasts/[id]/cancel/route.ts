import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { removeBroadcastSendJob } from '@/lib/whatsapp/broadcast-queue'
import { recalculateBroadcastStats } from '@/lib/whatsapp/broadcast-stats'

const CANCELLED_REASON = 'Not sent: the broadcast was cancelled.'

/**
 * Cancels a scheduled broadcast, or stops one that is sending. Recipients
 * not yet sent to are marked skipped; the worker checks the status between
 * batches, so at most one more batch goes out after a stop.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = String(session.id)
    const { id } = await params

    const { count } = await prisma.waBroadcast.updateMany({
      where: { id, user_id: userId, status: { in: ['scheduled', 'sending'] } },
      data: { status: 'cancelled' },
    })
    if (count === 0) {
      const exists = await prisma.waBroadcast.findFirst({ where: { id, user_id: userId }, select: { status: true } })
      if (!exists) return NextResponse.json({ error: 'Broadcast not found' }, { status: 404 })
      return NextResponse.json({ error: `A ${exists.status} broadcast cannot be cancelled` }, { status: 409 })
    }

    await prisma.waBroadcastRecipient.updateMany({
      where: { broadcast_id: id, status: 'pending' },
      data: { status: 'skipped', error_message: CANCELLED_REASON },
    })
    const stats = await recalculateBroadcastStats(id)

    // A running job stops by itself once it sees the status; a waiting one
    // would only no-op, but remove it so it doesn't linger in Redis.
    await removeBroadcastSendJob(id).catch((err) => {
      console.error('Could not remove broadcast job:', err instanceof Error ? err.message : err)
    })

    return NextResponse.json({ ok: true, stats })
  } catch (error) {
    console.error('Error cancelling broadcast:', error)
    return NextResponse.json({ error: 'Failed to cancel broadcast' }, { status: 500 })
  }
}
