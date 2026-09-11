'use server'

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { createAppointmentSchema } from '@/lib/validations/appointment'
import {
  normalizeAppointmentDate,
  normalizeAppointmentTime,
  normalizeCustomerPhone,
  timeToMinutes,
} from '@/lib/appointments/booking'

export async function getAppointments() {
  const appointments = await prisma.appointment.findMany({
    include: { contact: true },
    orderBy: [{ date: 'asc' }, { time: 'asc' }],
  })

  return {
    success: true,
    data: appointments.map((a: any) => ({
      id: a.id,
      customer: a.contact.name,
      phone: a.contact.phone,
      date: a.date.toISOString().split('T')[0],
      time: a.time,
      purpose: a.purpose,
      status: a.status.charAt(0) + a.status.slice(1).toLowerCase(),
      notes: a.notes,
    })),
  }
}

export async function createAppointment(data: unknown) {
  const parsed = createAppointmentSchema.safeParse(data)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const normalizedDate = normalizeAppointmentDate(parsed.data.date)
  const normalizedTime = normalizeAppointmentTime(parsed.data.time)
  const normalizedPhone = normalizeCustomerPhone(parsed.data.phone)
  if (!normalizedDate || !normalizedTime || !normalizedPhone) {
    return { success: false, error: 'Enter a future date, a listed slot and a valid phone number with country code.' }
  }

  try {
    const dayStart = new Date(`${normalizedDate}T00:00:00.000Z`)
    const dayEnd = new Date(`${normalizedDate}T23:59:59.999Z`)
    const existing = await prisma.appointment.findMany({
      where: { date: { gte: dayStart, lte: dayEnd }, status: { not: 'Cancelled' } },
      select: { time: true },
    })
    const requestedMinutes = timeToMinutes(normalizedTime)
    const conflict = existing.some((item) => {
      const bookedMinutes = timeToMinutes(item.time)
      return bookedMinutes !== null && requestedMinutes !== null && Math.abs(bookedMinutes - requestedMinutes) < 60
    })
    if (conflict) return { success: false, error: 'That appointment slot is already occupied.' }

    const appointment = await prisma.$transaction(async (tx) => {
      const contact = await tx.contact.upsert({
        where: { phone: normalizedPhone },
        update: { name: parsed.data.customer.trim() },
        create: { name: parsed.data.customer.trim(), phone: normalizedPhone },
      })
      return tx.appointment.create({
        data: {
          contactId: contact.id,
          date: new Date(normalizedDate),
          time: normalizedTime,
          purpose: parsed.data.purpose.trim(),
          notes: parsed.data.notes?.trim() || 'Booked manually from Call Center',
        },
      })
    })

    revalidatePath('/calls')
    return { success: true, data: { id: appointment.id } }
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002') {
      return { success: false, error: 'That appointment slot was just booked.' }
    }
    console.error('Failed to create appointment:', error)
    return { success: false, error: 'Appointment could not be saved.' }
  }
}

export async function updateAppointmentStatus(id: number, status: string) {
  if (!['Scheduled', 'Completed', 'Cancelled'].includes(status)) {
    return { success: false, error: 'Unsupported appointment status.' }
  }
  const appointment = await prisma.appointment.update({
    where: { id },
    data: { status },
  })

  revalidatePath('/calls')
  return { success: true, data: appointment }
}

export async function cancelAppointment(id: number) {
  return updateAppointmentStatus(id, 'Cancelled')
}
