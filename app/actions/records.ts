'use server'

import { prisma } from '@/lib/db'
import { getCurrentAdmin } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

function validIds(ids: unknown) {
  if (!Array.isArray(ids)) return []
  return [...new Set(ids.map(Number).filter(id => Number.isInteger(id) && id > 0))].slice(0, 10_000)
}

async function authorizedIds(ids: unknown) {
  if (!await getCurrentAdmin()) return { ids: [], error: 'Unauthorized.' }
  const normalized = validIds(ids)
  if (!normalized.length) return { ids: [], error: 'Select at least one record.' }
  return { ids: normalized, error: null }
}

function done(count: number, label: string) {
  revalidatePath('/calls')
  return { success: true, count, message: `${count} ${label}${count === 1 ? '' : 's'} deleted.` }
}

export async function getPhoneBook() {
  if (!await getCurrentAdmin()) return { success: false, error: 'Unauthorized.', data: [] }

  const calls = await prisma.callLog.findMany({
    where: { deletedAt: null },
    orderBy: { date: 'desc' },
    select: { customerName: true, phone: true, date: true },
  })
  const latestByPhone = new Map<string, { name: string; date: Date; totalCalls: number }>()
  for (const call of calls) {
    const existing = latestByPhone.get(call.phone)
    if (existing) existing.totalCalls += 1
    else latestByPhone.set(call.phone, { name: call.customerName, date: call.date, totalCalls: 1 })
  }

  const existingEntries = await prisma.phoneBookEntry.findMany({ select: { phone: true } })
  const existingPhones = new Set(existingEntries.map(entry => entry.phone))
  const additions = [...latestByPhone.entries()]
    .filter(([phone]) => !existingPhones.has(phone))
    .map(([phone, value]) => ({ phone, name: value.name || 'Unknown Customer' }))
  if (additions.length) await prisma.phoneBookEntry.createMany({ data: additions, skipDuplicates: true })

  const entries = await prisma.phoneBookEntry.findMany({
    where: { archivedAt: null },
    orderBy: { updatedAt: 'desc' },
  })
  return {
    success: true,
    data: entries.map(entry => {
      const call = latestByPhone.get(entry.phone)
      return {
        id: entry.id,
        name: call?.name || entry.name,
        phone: entry.phone,
        totalCalls: call?.totalCalls || 0,
        lastCall: call ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(call.date) : '—',
        tag: 'Customer',
      }
    }),
  }
}

export async function deletePhoneBookEntries(ids: unknown) {
  const { ids: selected, error } = await authorizedIds(ids)
  if (error) return { success: false, error }
  const result = await prisma.phoneBookEntry.updateMany({
    where: { id: { in: selected }, archivedAt: null },
    data: { archivedAt: new Date() },
  })
  return done(result.count, 'phone book entry')
}

export async function deleteCallLogs(ids: unknown) {
  const { ids: selected, error } = await authorizedIds(ids)
  if (error) return { success: false, error }
  const result = await prisma.callLog.updateMany({
    where: {
      id: { in: selected },
      deletedAt: null,
      status: { notIn: ['QUEUED', 'IN_PROGRESS'] },
    },
    data: { deletedAt: new Date() },
  })
  return done(result.count, 'call log')
}

export async function deleteTranscripts(callLogIds: unknown) {
  const { ids: selected, error } = await authorizedIds(callLogIds)
  if (error) return { success: false, error }
  const terminalCallIds = await prisma.callLog.findMany({
    where: { id: { in: selected }, deletedAt: null, status: { notIn: ['QUEUED', 'IN_PROGRESS'] } },
    select: { id: true },
  })
  const ids = terminalCallIds.map(call => call.id)
  if (!ids.length) return { success: false, error: 'Active call transcripts cannot be deleted.' }

  await prisma.$transaction([
    prisma.callTranscript.deleteMany({ where: { callLogId: { in: ids } } }),
    prisma.callLog.updateMany({ where: { id: { in: ids } }, data: { transcriptDeletedAt: new Date() } }),
  ])
  return done(ids.length, 'transcript')
}

export async function deleteCatalogueRequests(ids: unknown) {
  const { ids: selected, error } = await authorizedIds(ids)
  if (error) return { success: false, error }
  const result = await prisma.catalogueRequest.updateMany({
    where: { id: { in: selected }, deletedAt: null },
    data: { deletedAt: new Date() },
  })
  return done(result.count, 'catalogue request')
}

export async function deleteAppointments(ids: unknown) {
  const { ids: selected, error } = await authorizedIds(ids)
  if (error) return { success: false, error }
  const result = await prisma.appointment.updateMany({
    where: { id: { in: selected }, deletedAt: null },
    data: { deletedAt: new Date() },
  })
  return done(result.count, 'appointment')
}
