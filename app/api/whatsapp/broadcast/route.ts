import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

// Lists broadcasts for the Broadcasts tab. Sending happens in the queue
// worker (lib/queues/broadcast-send-worker.ts), started by
// /api/whatsapp/broadcasts/create.
export async function GET() {
  const session = await getSession()
  if (!session?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = String(session.id)

  try {
    const broadcasts = await prisma.waBroadcast.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
    })
    return NextResponse.json({ broadcasts })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch broadcasts'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
