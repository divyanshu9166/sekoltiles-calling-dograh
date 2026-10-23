import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const session = await getSession()
  if (!session?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = String(session.id)

  try {
    const original = await prisma.waAutomation.findFirst({
      where: { id, user_id: userId },
      include: {
        steps: {
          orderBy: { position: 'asc' }
        }
      }
    })

    if (!original) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const copy = await prisma.waAutomation.create({
      data: {
        user_id: userId,
        name: `${original.name} (Copy)`,
        description: original.description,
        trigger_type: original.trigger_type,
        trigger_config: original.trigger_config ?? {},
        is_active: false,
      }
    })

    if (original.steps && original.steps.length > 0) {
      const idMap = new Map<string, string>()
      const uid = () =>
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2) + Date.now().toString(36)
      
      for (const row of original.steps) {
        idMap.set(row.id, uid())
      }

      const rows = original.steps.map((row) => ({
        id: idMap.get(row.id)!,
        automation_id: copy.id,
        parent_step_id: row.parent_step_id ? idMap.get(row.parent_step_id) : null,
        branch: row.branch,
        step_type: row.step_type,
        step_config: row.step_config ?? {},
        position: row.position,
      }))
      
      await prisma.waAutomationStep.createMany({
        data: rows
      })
    }

    return NextResponse.json({ automation: copy }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'copy failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
