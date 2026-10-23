import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { buildLeadDeal, DEFAULT_PIPELINE_NAME, DEFAULT_STAGES } from './pipeline-rules'

// WhatsApp inquiries become deals in the "lead pipeline": the user's oldest
// pipeline that has stages, landing in its first stage (New Lead).

type Tx = Prisma.TransactionClient

// Serialises pipeline seeding and lead creation per user, so concurrent
// webhook deliveries (or a webhook racing the board's first load) can't
// create two default pipelines or two deals for the same contact.
async function lockUser(tx: Tx, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`wa-pipeline:${userId}`}))`
}

async function createDefaultPipeline(tx: Tx, userId: string) {
  const pipeline = await tx.waPipeline.create({ data: { user_id: userId, name: DEFAULT_PIPELINE_NAME } })
  await tx.waPipelineStage.createMany({
    data: DEFAULT_STAGES.map((stage) => ({ ...stage, pipeline_id: pipeline.id })),
  })
  return pipeline
}

/** Creates the default "Sales Pipeline" the first time a user has none. */
export async function ensureDefaultPipeline(userId: string) {
  return prisma.$transaction(async (tx) => {
    await lockUser(tx, userId)
    if ((await tx.waPipeline.count({ where: { user_id: userId } })) > 0) return false
    await createDefaultPipeline(tx, userId)
    return true
  })
}

async function findLeadStage(tx: Tx, userId: string) {
  const pipeline = await tx.waPipeline.findFirst({
    where: { user_id: userId, stages: { some: {} } },
    orderBy: { created_at: 'asc' },
    select: { id: true, stages: { orderBy: { position: 'asc' }, take: 1, select: { id: true } } },
  })
  if (pipeline) return { pipelineId: pipeline.id, stageId: pipeline.stages[0].id }

  // Only seed when the user has no pipelines at all; a pipeline whose stages
  // were all deleted is a deliberate setup we leave alone.
  if ((await tx.waPipeline.count({ where: { user_id: userId } })) > 0) return null
  const created = await createDefaultPipeline(tx, userId)
  const stage = await tx.waPipelineStage.findFirstOrThrow({
    where: { pipeline_id: created.id },
    orderBy: { position: 'asc' },
    select: { id: true },
  })
  return { pipelineId: created.id, stageId: stage.id }
}

/**
 * Adds an inbound WhatsApp inquirer to the lead pipeline unless they already
 * have an open deal. Returns the new deal id, or null when nothing was added.
 */
export async function addInboundLeadToPipeline(args: {
  userId: string
  contact: { id: string; name?: string | null; phone: string }
  conversationId: string
  firstMessage?: string | null
}) {
  return prisma.$transaction(async (tx) => {
    await lockUser(tx, args.userId)
    const open = await tx.waDeal.findFirst({
      where: { user_id: args.userId, contact_id: args.contact.id, status: 'open' },
      select: { id: true },
    })
    if (open) return null

    const target = await findLeadStage(tx, args.userId)
    if (!target) return null

    const deal = await tx.waDeal.create({
      data: {
        user_id: args.userId,
        pipeline_id: target.pipelineId,
        stage_id: target.stageId,
        contact_id: args.contact.id,
        conversation_id: args.conversationId,
        ...buildLeadDeal(args.contact, args.firstMessage),
        currency: 'INR',
        status: 'open',
      },
      select: { id: true },
    })
    return deal.id
  })
}

/**
 * Backfill: every contact who has messaged us but never had a deal gets one
 * in the first stage of `pipelineId`. Returns how many deals were created,
 * or null when the pipeline doesn't belong to the user or has no stages.
 */
export async function importWhatsAppLeads(userId: string, pipelineId: string) {
  return prisma.$transaction(async (tx) => {
    await lockUser(tx, userId)
    const pipeline = await tx.waPipeline.findFirst({
      where: { id: pipelineId, user_id: userId },
      select: { stages: { orderBy: { position: 'asc' }, take: 1, select: { id: true } } },
    })
    const stageId = pipeline?.stages[0]?.id
    if (!stageId) return null

    const contacts = await tx.waContact.findMany({
      where: {
        user_id: userId,
        deals: { none: {} },
        conversations: { some: { messages: { some: { sender_type: 'customer' } } } },
      },
      orderBy: { created_at: 'asc' },
      select: {
        id: true,
        name: true,
        phone: true,
        conversations: {
          take: 1,
          select: {
            id: true,
            messages: {
              where: { sender_type: 'customer' },
              orderBy: { created_at: 'asc' },
              take: 1,
              select: { content_text: true },
            },
          },
        },
      },
    })
    if (contacts.length === 0) return 0

    const { count } = await tx.waDeal.createMany({
      data: contacts.map((contact) => {
        const conversation = contact.conversations[0]
        return {
          user_id: userId,
          pipeline_id: pipelineId,
          stage_id: stageId,
          contact_id: contact.id,
          conversation_id: conversation?.id ?? null,
          ...buildLeadDeal(contact, conversation?.messages[0]?.content_text),
          currency: 'INR',
          status: 'open',
        }
      }),
    })
    return count
  })
}
