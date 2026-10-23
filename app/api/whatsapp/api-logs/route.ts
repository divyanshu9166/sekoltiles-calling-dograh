import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

/**
 * GET /api/whatsapp/api-logs
 *
 * Builds a live log feed from existing DB tables — no Redis required.
 *
 * Two event types are synthesised:
 *
 *   broadcast_send   — one entry per broadcast_recipient that has been
 *                      attempted (sent_at IS NOT NULL, or status=failed).
 *                      Shows the Meta message ID and template used.
 *
 *   webhook_status   — one entry per status milestone that Meta has
 *                      confirmed (delivered_at / read_at / replied_at).
 *                      Shows which status arrived and when.
 *
 * Sorted newest-first, capped at the 150 most recent entries so the
 * page stays snappy.
 */
export async function GET(request: Request) {
  const session = await getSession()
  if (!session?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = String(session.id)

  try {
    // ── Fetch recent recipient rows for this user ────────────────────
    const recipients = await prisma.waBroadcastRecipient.findMany({
      where: {
        broadcast: { user_id: userId },
        // Only rows that have at least been attempted
        OR: [
          { sent_at: { not: null } },
          { status: 'failed' },
        ],
      },
      orderBy: { created_at: 'desc' },
      take: 150,
      include: {
        broadcast: {
          select: { id: true, name: true, template_name: true },
        },
        contact: {
          select: { name: true, phone: true },
        },
      },
    })

    const logs: any[] = []
    let idx = 0

    for (const r of recipients) {
      const broadcastName = r.broadcast?.name ?? 'Unknown broadcast'
      const templateName  = r.broadcast?.template_name ?? ''
      const broadcastId   = r.broadcast?.id ?? ''
      const phone         = r.contact?.phone ?? '—'
      const contactName   = r.contact?.name ?? 'Unknown'

      // ── 1. Broadcast send event ──────────────────────────────────────
      if (r.sent_at || r.status === 'failed') {
        logs.push({
          id: `send-${r.id}`,
          ts: (r.sent_at ?? r.created_at).toISOString(),
          type: 'broadcast_send',
          status: r.status === 'failed' ? 'error' : 'success',
          phone,
          contactName,
          messageId: r.whatsapp_message_id ?? undefined,
          templateName,
          broadcastId,
          broadcastName,
          request: {
            templateName,
            to: phone,
            whatsapp_message_id: r.whatsapp_message_id ?? null,
          },
          response: r.status === 'failed'
            ? { error: r.error_message ?? 'Unknown error' }
            : { messageId: r.whatsapp_message_id, status: 'accepted_by_meta' },
          errorMessage: r.status === 'failed' ? (r.error_message ?? 'Failed to send') : undefined,
        })
        idx++
      }

      // ── 2. Webhook status events — one per milestone ─────────────────
      if (r.sent_at && r.status !== 'failed') {
        logs.push({
          id: `sent-${r.id}`,
          ts: r.sent_at.toISOString(),
          type: 'webhook_status',
          status: 'success',
          phone,
          contactName,
          messageId: r.whatsapp_message_id ?? undefined,
          eventStatus: 'sent',
          broadcastId,
          broadcastName,
          webhookPayload: {
            id: r.whatsapp_message_id,
            status: 'sent',
            recipient_phone: phone,
            timestamp: Math.floor(r.sent_at.getTime() / 1000),
          },
        })
      }

      if (r.delivered_at) {
        logs.push({
          id: `dlv-${r.id}`,
          ts: r.delivered_at.toISOString(),
          type: 'webhook_status',
          status: 'success',
          phone,
          contactName,
          messageId: r.whatsapp_message_id ?? undefined,
          eventStatus: 'delivered',
          broadcastId,
          broadcastName,
          webhookPayload: {
            id: r.whatsapp_message_id,
            status: 'delivered',
            recipient_phone: phone,
            timestamp: Math.floor(r.delivered_at.getTime() / 1000),
          },
        })
      }

      if (r.read_at) {
        logs.push({
          id: `read-${r.id}`,
          ts: r.read_at.toISOString(),
          type: 'webhook_status',
          status: 'success',
          phone,
          contactName,
          messageId: r.whatsapp_message_id ?? undefined,
          eventStatus: 'read',
          broadcastId,
          broadcastName,
          webhookPayload: {
            id: r.whatsapp_message_id,
            status: 'read',
            recipient_phone: phone,
            timestamp: Math.floor(r.read_at.getTime() / 1000),
          },
        })
      }

      if (r.replied_at) {
        logs.push({
          id: `rpl-${r.id}`,
          ts: r.replied_at.toISOString(),
          type: 'webhook_status',
          status: 'success',
          phone,
          contactName,
          messageId: r.whatsapp_message_id ?? undefined,
          eventStatus: 'replied',
          broadcastId,
          broadcastName,
          webhookPayload: {
            id: r.whatsapp_message_id,
            status: 'replied',
            recipient_phone: phone,
            timestamp: Math.floor(r.replied_at.getTime() / 1000),
          },
        })
      }
    }

    // Sort newest-first and cap
    logs.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    const trimmed = logs.slice(0, 200)

    return NextResponse.json({ logs: trimmed })
  } catch (error) {
    console.error('Error fetching api logs:', error)
    return NextResponse.json({ error: 'Failed to fetch logs' }, { status: 500 })
  }
}

// DELETE is now a no-op (no Redis store to clear), kept so the
// frontend Clear button doesn't 404.
export async function DELETE() {
  const session = await getSession()
  if (!session?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ ok: true, note: 'Logs are live DB data — nothing to clear' })
}