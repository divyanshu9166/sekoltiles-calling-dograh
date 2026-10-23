import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { resumePendingExecution } from '@/lib/automations/engine'
import type { AutomationContext } from '@/lib/automations/engine'

export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret')
  if (supplied !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const due = await prisma.waAutomationPendingExecution.findMany({
      where: {
        status: 'pending',
        run_at: { lte: new Date() }
      },
      orderBy: { run_at: 'asc' },
      take: 50
    })

    if (!due || due.length === 0) return NextResponse.json({ processed: 0 })

    let processed = 0
    for (const row of due) {
      // Claim lock
      const claim = await prisma.waAutomationPendingExecution.updateMany({
        where: { id: row.id, status: 'pending' },
        data: { status: 'running' }
      })

      if (claim.count === 0) continue

      await resumePendingExecution({
        id: row.id,
        automation_id: row.automation_id,
        user_id: row.user_id,
        contact_id: row.contact_id,
        log_id: row.log_id,
        parent_step_id: row.parent_step_id,
        branch: row.branch as 'yes' | 'no' | null,
        next_step_position: row.next_step_position,
        context: (row.context as AutomationContext) ?? {},
      })
      processed++
    }

    return NextResponse.json({ processed })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
