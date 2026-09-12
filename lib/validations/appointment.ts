import { z } from 'zod'

export const createAppointmentSchema = z.object({
  customer: z.string().min(1),
  phone: z.string().min(10),
  date: z.string().min(1),
  time: z.string().min(1),
  purpose: z.string().min(1),
  region: z.string().trim().max(120).optional(),
  notes: z.string().optional(),
})

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>
