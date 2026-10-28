import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'
import { recalculateBroadcastStats } from '@/lib/whatsapp/broadcast-stats'
import { recordOutboundTemplateMessage } from '@/lib/whatsapp/outbound-message-log'
import type { BroadcastStore } from '@/lib/whatsapp/broadcast-sender'

/** Prisma-backed BroadcastStore used by the broadcast worker. */
export const prismaBroadcastStore: BroadcastStore = {
  async getBroadcast(id) {
    return prisma.waBroadcast.findUnique({
      where: { id },
      select: {
        id: true,
        user_id: true,
        status: true,
        template_name: true,
        template_language: true,
        template_variables: true,
        header_media: true,
        template_extras: true,
        scheduled_at: true,
      },
    })
  },

  async claimForSending(id) {
    const { count } = await prisma.waBroadcast.updateMany({
      where: { id, status: { in: ['scheduled', 'sending'] } },
      data: { status: 'sending', error_message: null },
    })
    return count === 1
  },

  async getStatus(id) {
    const row = await prisma.waBroadcast.findUnique({ where: { id }, select: { status: true } })
    return row?.status ?? null
  },

  async getSenderConfig(userId) {
    const config = await prisma.waWhatsappConfig.findUnique({ where: { user_id: userId } })
    if (!config?.phone_number_id || !config.access_token) return null
    return { phoneNumberId: config.phone_number_id, accessToken: decrypt(config.access_token) }
  },

  async getTemplateBody(userId, name, language) {
    const template = await prisma.waMessageTemplate.findFirst({
      where: { user_id: userId, name, language },
      select: { body_text: true },
    })
    return template?.body_text ?? null
  },

  async claimNextRecipient(broadcastId, excludeIds) {
    // SKIP LOCKED + the status flip in one statement: two runs of the same
    // job can never claim the same recipient.
    const claimed = await prisma.$queryRaw<{ id: string }[]>`
      UPDATE "broadcast_recipients" SET "status" = 'sending'
      WHERE "id" = (
        SELECT "id" FROM "broadcast_recipients"
        WHERE "broadcast_id" = ${broadcastId}
          AND "status" = 'pending'
          AND NOT ("id" = ANY(${excludeIds}::text[]))
        ORDER BY "id"
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      AND "status" = 'pending'
      RETURNING "id"`
    const id = claimed[0]?.id
    if (!id) return null

    const row = await prisma.waBroadcastRecipient.findUnique({
      where: { id },
      select: {
        contact: {
          select: {
            id: true,
            phone: true,
            name: true,
            email: true,
            company: true,
            opted_out_at: true,
            contact_custom_values: { select: { custom_field_id: true, value: true } },
          },
        },
      },
    })
    const contact = row?.contact ?? null
    return {
      id,
      contact: contact
        ? {
            id: contact.id,
            phone: contact.phone,
            name: contact.name,
            email: contact.email,
            company: contact.company,
            opted_out_at: contact.opted_out_at,
          }
        : null,
      customValues: Object.fromEntries(
        (contact?.contact_custom_values ?? []).map((v) => [v.custom_field_id, v.value ?? '']),
      ),
    }
  },

  async releaseRecipient(recipientId) {
    await prisma.waBroadcastRecipient.updateMany({
      where: { id: recipientId, status: 'sending' },
      data: { status: 'pending' },
    })
  },

  async markSent(recipientId, whatsappMessageId) {
    await prisma.waBroadcastRecipient.update({
      where: { id: recipientId },
      data: { status: 'sent', whatsapp_message_id: whatsappMessageId, sent_at: new Date(), error_message: null },
    })
  },

  async markUnsent(recipientId, status, error) {
    await prisma.waBroadcastRecipient.update({
      where: { id: recipientId },
      data: { status, error_message: error },
    })
  },

  async closePending(broadcastId, status, error) {
    await prisma.waBroadcastRecipient.updateMany({
      where: { broadcast_id: broadcastId, status: 'pending' },
      data: { status, error_message: error },
    })
  },

  async failInFlight(broadcastId, error) {
    await prisma.waBroadcastRecipient.updateMany({
      where: { broadcast_id: broadcastId, status: 'sending' },
      data: { status: 'failed', error_message: error },
    })
  },

  async refreshStats(broadcastId) {
    return recalculateBroadcastStats(broadcastId)
  },

  async finish(broadcastId, status, error) {
    await prisma.waBroadcast.updateMany({
      where: { id: broadcastId, status: 'sending' },
      data: { status, error_message: error },
    })
  },

  async recordMessage(args) {
    await recordOutboundTemplateMessage({ ...args, senderId: args.userId })
  },
}
