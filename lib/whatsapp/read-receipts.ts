import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'
import { markMessageRead } from '@/lib/whatsapp/meta-api'

// Meta only accepts read receipts for messages received in the last 30 days.
const READ_RECEIPT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Show the customer blue ticks on their latest message (WhatsApp marks every
 * earlier one read too), optionally with a typing indicator. Best effort:
 * a failure is logged and never blocks the inbox.
 */
export async function markConversationRead(args: {
  userId: string
  conversationId: string
  typing?: boolean
}): Promise<boolean> {
  const { userId, conversationId, typing } = args
  try {
    const latest = await prisma.waMessage.findFirst({
      where: {
        conversation_id: conversationId,
        conversation: { user_id: userId },
        sender_type: 'customer',
        message_id: { not: null },
        created_at: { gte: new Date(Date.now() - READ_RECEIPT_WINDOW_MS) },
      },
      orderBy: { created_at: 'desc' },
      select: { message_id: true },
    })
    if (!latest?.message_id) return false

    const config = await prisma.waWhatsappConfig.findUnique({ where: { user_id: userId } })
    if (!config) return false

    await markMessageRead({
      phoneNumberId: config.phone_number_id,
      accessToken: decrypt(config.access_token),
      messageId: latest.message_id,
      typing,
    })
    return true
  } catch (error) {
    console.warn(
      `[whatsapp] ${typing ? 'typing indicator' : 'read receipt'} failed:`,
      error instanceof Error ? error.message : error,
    )
    return false
  }
}
