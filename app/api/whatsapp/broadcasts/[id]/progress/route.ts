import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { deriveBroadcastStats } from '@/lib/whatsapp/broadcast-stats'

/** Small payload the detail page polls while a broadcast is scheduled or sending. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = String(session.id)
    const { id } = await params

    const broadcast = await prisma.waBroadcast.findFirst({ where: { id, user_id: userId } })
    if (!broadcast) return NextResponse.json({ error: 'Broadcast not found' }, { status: 404 })

    const grouped = await prisma.waBroadcastRecipient.groupBy({
      by: ['status'],
      where: { broadcast_id: id },
      _count: { _all: true },
    })
    const counts: Record<string, number> = {}
    for (const row of grouped) counts[row.status] = row._count._all

    // Stored counts are refreshed once per batch; these are exact right now.
    return NextResponse.json({ broadcast: { ...broadcast, ...deriveBroadcastStats(counts) }, counts })
  } catch (error) {
    console.error('Error fetching broadcast progress:', error)
    return NextResponse.json({ error: 'Failed to fetch broadcast progress' }, { status: 500 })
  }
}
