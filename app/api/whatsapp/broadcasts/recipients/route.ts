import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

export async function POST(request: Request) {
  try {
    const session = await getSession()
    if (!session?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    
    const { broadcastId, updates } = await request.json()
    // updates: { contact_id: string, status: 'sent' | 'failed', whatsapp_message_id?: string, error_message?: string }[]

    // Fetch the broadcast to get user_id (needed for conversation creation)
    const broadcast = await prisma.waBroadcast.findUnique({
      where: { id: broadcastId },
      select: { id: true, user_id: true, template_name: true },
    })
    if (!broadcast) return NextResponse.json({ error: 'Broadcast not found' }, { status: 404 })

    // Apply each recipient update
    for (const update of updates) {
      await prisma.waBroadcastRecipient.updateMany({
        where: { broadcast_id: broadcastId, contact_id: update.contact_id },
        data: {
          status: update.status,
          whatsapp_message_id: update.whatsapp_message_id || null,
          error_message: update.error_message || null,
          sent_at: update.status === 'sent' ? new Date() : undefined,
        }
      })

      // For successfully sent messages, upsert a conversation row so the
      // contact immediately appears in the Inbox and any reply they send
      // lands in the right thread.
      // We use upsert with the @@unique([user_id, contact_id]) compound
      // key — this is atomic and race-condition-safe on repeated calls.
      if (update.status === 'sent' && update.contact_id) {
        try {
          await prisma.waConversation.upsert({
            where: {
              user_id_contact_id: {
                user_id: broadcast.user_id,
                contact_id: update.contact_id,
              },
            },
            create: {
              user_id: broadcast.user_id,
              contact_id: update.contact_id,
              last_message_text: `Broadcast: ${broadcast.template_name}`,
              last_message_at: new Date(),
            },
            update: {
              // Bump last_message_at so this broadcast appears at the top
              // of the Inbox list (sorted by recency). Don't overwrite the
              // text if a more recent inbound message already set it.
              last_message_at: new Date(),
              last_message_text: `Broadcast: ${broadcast.template_name}`,
            },
          })
        } catch (convErr) {
          // Non-fatal: a missing conversation only affects the Inbox view
          console.error('Failed to upsert conversation for broadcast recipient:', convErr)
        }
      }
    }

    // Re-derive aggregate counts directly from recipient rows.
    // This is intentionally done in application code rather than relying
    // on a Postgres trigger, so counts stay correct even if the DB
    // migration that installs the trigger hasn't been applied.
    const agg = await prisma.waBroadcastRecipient.groupBy({
      by: ['status'],
      where: { broadcast_id: broadcastId },
      _count: { status: true },
    })

    const countByStatus: Record<string, number> = {}
    for (const row of agg) {
      countByStatus[row.status] = row._count.status
    }

    // Ladder semantics (same as the DB trigger):
    //   sent_count      = recipients at or past 'sent' (sent|delivered|read|replied)
    //   delivered_count = recipients at or past 'delivered'
    //   read_count      = recipients at or past 'read'
    //   replied_count   = exactly 'replied'
    //   failed_count    = exactly 'failed'
    const s = (k: string) => countByStatus[k] ?? 0
    const sent_count      = s('sent') + s('delivered') + s('read') + s('replied')
    const delivered_count = s('delivered') + s('read') + s('replied')
    const read_count      = s('read') + s('replied')
    const replied_count   = s('replied')
    const failed_count    = s('failed')

    await prisma.waBroadcast.update({
      where: { id: broadcastId },
      data: { sent_count, delivered_count, read_count, replied_count, failed_count },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Error updating broadcast recipients:', error)
    return NextResponse.json({ error: 'Failed to update broadcast recipients' }, { status: 500 })
  }
}