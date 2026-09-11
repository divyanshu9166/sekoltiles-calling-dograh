import { z } from 'zod'

export const createCallLogSchema = z.object({
  customerName: z.string().min(1),
  phone: z.string().min(10),
  direction: z.enum(['INBOUND', 'OUTBOUND']),
  status: z.enum(['COMPLETED', 'MISSED', 'NO_ANSWER', 'BUSY']),
  duration: z.string().optional(),
  durationSec: z.number().default(0),
  agent: z.string().default('AI Agent'),
  purpose: z.string().optional(),
  outcome: z.string().optional(),
  notes: z.string().optional(),
  recording: z.boolean().default(false),
})

export type CreateCallLogInput = z.infer<typeof createCallLogSchema>
