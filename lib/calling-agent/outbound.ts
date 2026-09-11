import { prisma } from '@/lib/db'
import { triggerDograhCall } from '@/lib/dograh'

type OutboundCall = {
  phoneNumber: string
  customerName: string
  reason: string
}

/** Creates the durable CRM record before Dograh asks Vobiz to dial. */
export async function startOutboundAICall({ phoneNumber, customerName, reason }: OutboundCall) {
  const now = new Date()
  const contact = await prisma.contact.findUnique({ where: { phone: phoneNumber } })

  const callLog = await prisma.callLog.create({
    data: {
      contactId: contact?.id,
      customerName: customerName || 'Unknown Customer',
      phone: phoneNumber,
      direction: 'OUTBOUND',
      status: 'QUEUED',
      duration: '0:00',
      durationSec: 0,
      agent: 'AI Agent - Anushka',
      date: now,
      time: now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }),
      purpose: reason,
      outcome: 'Queued in Dograh',
      notes: 'Outbound call requested through Dograh orchestration',
      recording: false,
      callType: 'ai_outbound',
      aiHandled: true,
    },
  })

  try {
    const run = await triggerDograhCall({
      phoneNumber,
      customerName,
      reason,
      crmCallLogId: callLog.id,
    })
    await prisma.callLog.update({
      where: { id: callLog.id },
      data: {
        dograhRunId: String(run.workflow_run_id),
        outcome: 'Dograh call initiated',
        notes: `Dograh run ${run.workflow_run_name}`,
      },
    })
    return { dograhRunId: String(run.workflow_run_id), callLogId: callLog.id }
  } catch (error) {
    await prisma.callLog.update({
      where: { id: callLog.id },
      data: { status: 'FAILED', outcome: 'Dograh could not initiate the call' },
    })
    throw error
  }
}
