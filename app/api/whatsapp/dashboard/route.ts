import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import {
  daysAgoStart,
  lastNDayKeys,
  localDayKey,
  mondayIndex,
} from '@/lib/wa-dashboard/date-utils'
import type {
  ActivityItem,
  ConversationsSeriesPoint,
  MetricsBundle,
  PipelineDonutData,
  PipelineStageSlice,
  ResponseTimeBucket,
  ResponseTimeSummary,
} from '@/lib/wa-dashboard/types'

/**
 * GET /api/whatsapp/dashboard?range=30
 *
 * Returns all data the Overview tab needs in one request:
 *   { metrics, series, pipeline, responseTime, activity }
 *
 * The `range` query param controls the conversations-over-time series
 * (7 | 30 | 90 days). All other sections use fixed windows.
 */
export async function GET(request: Request) {
  const session = await getSession()
  if (!session?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = String(session.id)

  const { searchParams } = new URL(request.url)
  const rangeDays = Math.min(
    90,
    Math.max(7, parseInt(searchParams.get('range') ?? '30', 10)),
  )

  try {
    const [metrics, series, pipeline, responseTime, activity] = await Promise.all([
      buildMetrics(userId),
      buildSeries(userId, rangeDays),
      buildPipelineDonut(userId),
      buildResponseTime(userId),
      buildActivity(userId, 50),
    ])

    return NextResponse.json({ metrics, series, pipeline, responseTime, activity })
  } catch (err) {
    console.error('[dashboard API]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

async function buildMetrics(userId: string): Promise<MetricsBundle> {
  const todayStart = daysAgoStart(0)
  const yesterdayStart = daysAgoStart(1)

  const [
    openConvCount,
    newConvToday,
    newConvYesterday,
    newContactsToday,
    newContactsYesterday,
    openDeals,
    messagesToday,
    messagesYesterday,
  ] = await Promise.all([
    prisma.waConversation.count({ where: { user_id: userId, status: 'open' } }),
    prisma.waConversation.count({
      where: { user_id: userId, status: 'open', created_at: { gte: todayStart } },
    }),
    prisma.waConversation.count({
      where: {
        user_id: userId,
        status: 'open',
        created_at: { gte: yesterdayStart, lt: todayStart },
      },
    }),
    prisma.waContact.count({
      where: { user_id: userId, created_at: { gte: todayStart } },
    }),
    prisma.waContact.count({
      where: { user_id: userId, created_at: { gte: yesterdayStart, lt: todayStart } },
    }),
    prisma.waDeal.findMany({
      where: { user_id: userId, status: 'open' },
      select: { value: true },
    }),
    prisma.waMessage.count({
      where: {
        conversation: { user_id: userId },
        sender_type: 'agent',
        created_at: { gte: todayStart },
      },
    }),
    prisma.waMessage.count({
      where: {
        conversation: { user_id: userId },
        sender_type: 'agent',
        created_at: { gte: yesterdayStart, lt: todayStart },
      },
    }),
  ])

  const openDealsValue = openDeals.reduce((sum, d) => sum + (d.value ?? 0), 0)

  return {
    activeConversations: {
      current: openConvCount,
      previous: newConvToday - newConvYesterday,
    },
    newContactsToday: {
      current: newContactsToday,
      previous: newContactsYesterday,
    },
    openDealsValue,
    openDealsCount: openDeals.length,
    messagesSentToday: {
      current: messagesToday,
      previous: messagesYesterday,
    },
  }
}

async function buildSeries(
  userId: string,
  rangeDays: number,
): Promise<ConversationsSeriesPoint[]> {
  const start = daysAgoStart(rangeDays - 1)

  const messages = await prisma.waMessage.findMany({
    where: {
      conversation: { user_id: userId },
      created_at: { gte: start },
    },
    select: { created_at: true, sender_type: true },
    orderBy: { created_at: 'asc' },
  })

  const keys = lastNDayKeys(rangeDays)
  const buckets = new Map<string, { incoming: number; outgoing: number }>()
  for (const k of keys) buckets.set(k, { incoming: 0, outgoing: 0 })

  for (const msg of messages) {
    const key = localDayKey(msg.created_at)
    const bucket = buckets.get(key)
    if (!bucket) continue
    if (msg.sender_type === 'customer') bucket.incoming += 1
    else bucket.outgoing += 1
  }

  return keys.map((day) => ({ day, ...(buckets.get(day) ?? { incoming: 0, outgoing: 0 }) }))
}

async function buildPipelineDonut(userId: string): Promise<PipelineDonutData> {
  const [stages, deals] = await Promise.all([
    prisma.waPipelineStage.findMany({
      where: { pipeline: { user_id: userId } },
      select: { id: true, name: true, color: true },
      orderBy: { position: 'asc' },
    }),
    prisma.waDeal.findMany({
      where: { user_id: userId, status: 'open' },
      select: { stage_id: true, value: true },
    }),
  ])

  const byStage = new Map<string, { count: number; total: number }>()
  for (const d of deals) {
    const row = byStage.get(d.stage_id) ?? { count: 0, total: 0 }
    row.count += 1
    row.total += d.value ?? 0
    byStage.set(d.stage_id, row)
  }

  const slices: PipelineStageSlice[] = stages
    .map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color || '#64748b',
      dealCount: byStage.get(s.id)?.count ?? 0,
      totalValue: byStage.get(s.id)?.total ?? 0,
    }))
    .filter((s) => s.totalValue > 0 || s.dealCount > 0)

  return {
    stages: slices,
    totalValue: slices.reduce((sum, s) => sum + s.totalValue, 0),
  }
}

async function buildResponseTime(userId: string): Promise<ResponseTimeSummary> {
  const fourteenDaysAgo = daysAgoStart(13)

  const messages = await prisma.waMessage.findMany({
    where: {
      conversation: { user_id: userId },
      created_at: { gte: fourteenDaysAgo },
    },
    select: { conversation_id: true, sender_type: true, created_at: true },
    orderBy: [{ conversation_id: 'asc' }, { created_at: 'asc' }],
  })

  interface Sample { customerAt: Date; responseAt: Date }
  const samples: Sample[] = []

  let currentConv = ''
  let pendingCustomer: Date | null = null
  for (const row of messages) {
    if (row.conversation_id !== currentConv) {
      currentConv = row.conversation_id
      pendingCustomer = null
    }
    const ts = new Date(row.created_at)
    if (row.sender_type === 'customer') {
      if (!pendingCustomer) pendingCustomer = ts
    } else if (pendingCustomer) {
      samples.push({ customerAt: pendingCustomer, responseAt: ts })
      pendingCustomer = null
    }
  }

  const now = new Date()
  const thisWeekStart = daysAgoStart(mondayIndex(now))
  const lastWeekStart = daysAgoStart(mondayIndex(now) + 7)

  const byDow = new Map<number, number[]>()
  for (let i = 0; i < 7; i++) byDow.set(i, [])
  const thisWeekMins: number[] = []
  const lastWeekMins: number[] = []

  for (const s of samples) {
    const diffMin = (s.responseAt.getTime() - s.customerAt.getTime()) / 60_000
    if (diffMin < 0) continue
    const dow = mondayIndex(s.customerAt)
    byDow.get(dow)!.push(diffMin)
    if (s.customerAt >= thisWeekStart) {
      thisWeekMins.push(diffMin)
    } else if (s.customerAt >= lastWeekStart && s.customerAt < thisWeekStart) {
      lastWeekMins.push(diffMin)
    }
  }

  const avg = (arr: number[]) =>
    arr.length === 0 ? null : arr.reduce((a, b) => a + b, 0) / arr.length

  const buckets: ResponseTimeBucket[] = Array.from({ length: 7 }, (_, dow) => {
    const s = byDow.get(dow) ?? []
    return { dow, avgMinutes: avg(s), samples: s.length }
  })

  return {
    buckets,
    thisWeekAvg: avg(thisWeekMins),
    lastWeekAvg: avg(lastWeekMins),
  }
}

async function buildActivity(userId: string, limit: number): Promise<ActivityItem[]> {
  const [messages, contacts, deals, broadcasts, autoLogs] = await Promise.all([
    prisma.waMessage.findMany({
      where: { conversation: { user_id: userId }, sender_type: 'customer' },
      select: {
        id: true,
        content_text: true,
        created_at: true,
        conversation_id: true,
        conversation: {
          select: { contact: { select: { name: true, phone: true } } },
        },
      },
      orderBy: { created_at: 'desc' },
      take: 10,
    }),
    prisma.waContact.findMany({
      where: { user_id: userId },
      select: { id: true, name: true, phone: true, created_at: true },
      orderBy: { created_at: 'desc' },
      take: 10,
    }),
    prisma.waDeal.findMany({
      where: { user_id: userId },
      select: {
        id: true,
        title: true,
        updated_at: true,
        stage: { select: { name: true } },
      },
      orderBy: { updated_at: 'desc' },
      take: 10,
    }),
    prisma.waBroadcast.findMany({
      where: { user_id: userId },
      select: { id: true, name: true, status: true, total_recipients: true, created_at: true },
      orderBy: { created_at: 'desc' },
      take: 5,
    }),
    prisma.waAutomationLog.findMany({
      where: { user_id: userId },
      select: {
        id: true,
        trigger_event: true,
        status: true,
        created_at: true,
        automation: { select: { name: true } },
        contact: { select: { name: true, phone: true } },
      },
      orderBy: { created_at: 'desc' },
      take: 10,
    }),
  ])

  const items: ActivityItem[] = []

  for (const m of messages) {
    const contact = m.conversation?.contact
    const who = contact?.name || contact?.phone || 'Unknown'
    items.push({
      id: `msg-${m.id}`,
      kind: 'message',
      text: `New message from ${who}`,
      at: m.created_at.toISOString(),
      href: `/whatsapp-marketing?tab=inbox&c=${m.conversation_id}`,
    })
  }

  for (const c of contacts) {
    items.push({
      id: `contact-${c.id}`,
      kind: 'contact',
      text: `New contact: ${c.name || c.phone}`,
      at: c.created_at.toISOString(),
      href: '/whatsapp-marketing?tab=contacts',
    })
  }

  for (const d of deals) {
    items.push({
      id: `deal-${d.id}`,
      kind: 'deal',
      text: d.stage?.name
        ? `Deal "${d.title}" in ${d.stage.name}`
        : `Deal "${d.title}" updated`,
      at: d.updated_at.toISOString(),
      href: '/whatsapp-marketing?tab=pipelines',
    })
  }

  for (const b of broadcasts) {
    const label =
      b.status === 'sent'
        ? `sent to ${b.total_recipients} contacts`
        : `${b.status} (${b.total_recipients} recipients)`
    items.push({
      id: `broadcast-${b.id}`,
      kind: 'broadcast',
      text: `Broadcast "${b.name}" ${label}`,
      at: b.created_at.toISOString(),
      href: '/whatsapp-marketing?tab=broadcasts',
    })
  }

  for (const l of autoLogs) {
    const who = l.contact?.name || l.contact?.phone || 'a contact'
    const autoName = l.automation?.name || 'Automation'
    items.push({
      id: `auto-${l.id}`,
      kind: 'automation',
      text: `Automation "${autoName}" ${l.status === 'failed' ? 'failed for' : 'triggered for'} ${who}`,
      at: l.created_at.toISOString(),
    })
  }

  return items
    .sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0))
    .slice(0, limit)
}
