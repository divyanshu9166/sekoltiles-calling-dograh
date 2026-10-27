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

  async listPendingRecipients(broadcastId, limit, excludeIds) {
    const rows = await prisma.waBroadcastRecipient.findMany({
      where: {
        broadcast_id: broadcastId,
        status: 'pending',
        ...(excludeIds.length ? { id: { notIn: excludeIds } } : {}),
      },
      orderBy: { id: 'asc' },
      take: limit,
      select: {
        id: true,
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
    return rows.map(({ id, contact }) => ({
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
    }))
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

  async failAllPending(broadcastId, error) {
    await prisma.waBroadcastRecipient.updateMany({
      where: { broadcast_id: broadcastId, status: 'pending' },
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
