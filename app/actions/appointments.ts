'use server'

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { createAppointmentSchema } from '@/lib/validations/appointment'
import {
  normalizeAppointmentDate,
  normalizeAppointmentTime,
  normalizeCustomerPhone,
  isSundayAppointmentDate,
} from '@/lib/appointments/booking'
import { getCurrentAdmin } from '@/lib/auth'

export async function getAppointments() {
  if (!await getCurrentAdmin()) return { success: false, error: 'Unauthorized.', data: [] }
  const appointments = await prisma.appointment.findMany({
    where: { deletedAt: null },
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
      region: a.region,
      status: a.status.charAt(0) + a.status.slice(1).toLowerCase(),
      notes: a.notes,
    })),
  }
}

export async function createAppointment(data: unknown) {
  if (!await getCurrentAdmin()) return { success: false, error: 'Unauthorized.' }
  const parsed = createAppointmentSchema.safeParse(data)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }

  const normalizedDate = normalizeAppointmentDate(parsed.data.date)
  const normalizedTime = normalizeAppointmentTime(parsed.data.time)
  const normalizedPhone = normalizeCustomerPhone(parsed.data.phone)
  if (!normalizedDate || !normalizedTime || !normalizedPhone) {
    return { success: false, error: 'Enter a future date, a time from 9:00 AM to 5:00 PM and a valid phone number with country code.' }
  }
  if (isSundayAppointmentDate(normalizedDate)) {
    return { success: false, error: 'Showroom appointments are closed on Sundays. Please choose Monday–Saturday.' }
  }

  try {
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
          region: parsed.data.region?.trim() || null,
          notes: parsed.data.notes?.trim() || 'Booked manually from Call Center',
        },
      })
    })

    revalidatePath('/calls')
    return { success: true, data: { id: appointment.id } }
  } catch (error: unknown) {
    console.error('Failed to create appointment:', error)
    return { success: false, error: 'Appointment could not be saved.' }
  }
}

export async function updateAppointmentStatus(id: number, status: string) {
  if (!await getCurrentAdmin()) return { success: false, error: 'Unauthorized.' }
  if (!['Scheduled', 'Completed', 'Cancelled'].includes(status)) {
    return { success: false, error: 'Unsupported appointment status.' }
  }
  const appointment = await prisma.appointment.updateMany({
    where: { id, deletedAt: null },
    data: { status },
  })

  if (!appointment.count) return { success: false, error: 'Appointment was not found.' }

  revalidatePath('/calls')
  return { success: true }
}

export async function cancelAppointment(id: number) {
  return updateAppointmentStatus(id, 'Cancelled')
}
