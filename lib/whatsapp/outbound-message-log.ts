import { prisma } from '@/lib/db'
import { publishEvent } from '@/lib/redis'

function renderTemplateBody(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, raw) => {
    const idx = Number(raw) - 1
    return params[idx] ?? ''
  })
}

export async function renderTemplatePreview(args: {
  userId: string
  templateName: string
  language: string
  params: string[]
}) {
  const template = await prisma.waMessageTemplate.findFirst({
    where: {
      user_id: args.userId,
      name: args.templateName,
      language: args.language,
    },
    select: { body_text: true },
  })

  if (!template?.body_text) return `[Template: ${args.templateName}]`
  return renderTemplateBody(template.body_text, args.params)
}

export async function recordOutboundTemplateMessage(args: {
  userId: string
  contactId: string
  senderId: string
  templateName: string
  renderedText: string
  whatsappMessageId: string
}) {
  const contact = await prisma.waContact.findFirst({
    where: { id: args.contactId, user_id: args.userId },
  })

  if (!contact) return null

  const existingMessage = await prisma.waMessage.findFirst({
    where: { message_id: args.whatsappMessageId },
    select: { id: true },
  })

  if (existingMessage) return existingMessage

  const existingConversation = await prisma.waConversation.findFirst({
    where: { user_id: args.userId, contact_id: contact.id },
    select: { id: true },
  })

  const timestamp = new Date()
  const conversation = await prisma.waConversation.upsert({
    where: {
      user_id_contact_id: {
        user_id: args.userId,
        contact_id: contact.id,
      },
    },
    update: {
      last_message_text: args.renderedText,
      last_message_at: timestamp,
    },
    create: {
      user_id: args.userId,
      contact_id: contact.id,
      last_message_text: args.renderedText,
      last_message_at: timestamp,
      unread_count: 0,
    },
    include: { contact: true },
  })

  const message = await prisma.waMessage.create({
    data: {
      conversation_id: conversation.id,
      sender_type: 'agent',
      sender_id: args.senderId,
      content_type: 'template',
      content_text: args.renderedText,
      template_name: args.templateName,
      message_id: args.whatsappMessageId,
      status: 'sent',
      created_at: timestamp,
    },
  })

  if (!existingConversation) {
    await publishEvent('chat_events', {
      type: 'new_conversation',
      userId: args.userId,
      conversationId: conversation.id,
      payload: { conversation },
    })
  } else {
    await publishEvent('chat_events', {
      type: 'conversation_update',
      userId: args.userId,
      conversationId: conversation.id,
      payload: {
        last_message_text: conversation.last_message_text,
        last_message_at: conversation.last_message_at?.toISOString() ?? null,
        unread_count: conversation.unread_count,
      },
    })
  }

  await publishEvent('chat_events', {
    type: 'new_message',
    userId: args.userId,
    conversationId: conversation.id,
    payload: {
      message: {
        ...message,
        created_at: message.created_at.toISOString(),
      },
    },
  })

  return message
}
