import { prisma } from '@/lib/db'

const SUCCESS_SENT_STATUSES = new Set(['sent', 'delivered', 'read', 'replied'])
const SUCCESS_DELIVERED_STATUSES = new Set(['delivered', 'read', 'replied'])
const SUCCESS_READ_STATUSES = new Set(['read', 'replied'])

export interface BroadcastStats {
  total_recipients: number
  sent_count: number
  delivered_count: number
  read_count: number
  replied_count: number
  failed_count: number
}

export function deriveBroadcastStats(
  statusCounts: Record<string, number>,
): BroadcastStats {
  let total = 0
  let sent = 0
  let delivered = 0
  let read = 0

  for (const [status, count] of Object.entries(statusCounts)) {
    total += count
    if (SUCCESS_SENT_STATUSES.has(status)) sent += count
    if (SUCCESS_DELIVERED_STATUSES.has(status)) delivered += count
    if (SUCCESS_READ_STATUSES.has(status)) read += count
  }

  return {
    total_recipients: total,
    sent_count: sent,
    delivered_count: delivered,
    read_count: read,
    replied_count: statusCounts.replied ?? 0,
    failed_count: statusCounts.failed ?? 0,
  }
}

export async function getBroadcastStatsByIds(
  broadcastIds: string[],
): Promise<Map<string, BroadcastStats>> {
  const stats = new Map<string, BroadcastStats>()
  if (broadcastIds.length === 0) return stats

  const grouped = await prisma.waBroadcastRecipient.groupBy({
    by: ['broadcast_id', 'status'],
    where: { broadcast_id: { in: broadcastIds } },
    _count: { _all: true },
  })

  const countsByBroadcast = new Map<string, Record<string, number>>()
  for (const row of grouped) {
    const bucket = countsByBroadcast.get(row.broadcast_id) ?? {}
    bucket[row.status] = row._count._all
    countsByBroadcast.set(row.broadcast_id, bucket)
  }

  for (const id of broadcastIds) {
    stats.set(id, deriveBroadcastStats(countsByBroadcast.get(id) ?? {}))
  }

  return stats
}

export async function recalculateBroadcastStats(
  broadcastId: string,
): Promise<BroadcastStats> {
  const stats =
    (await getBroadcastStatsByIds([broadcastId])).get(broadcastId) ??
    deriveBroadcastStats({})

  await prisma.waBroadcast.update({
    where: { id: broadcastId },
    data: stats,
  })

  return stats
}
