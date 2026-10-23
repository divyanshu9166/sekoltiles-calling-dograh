import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = String(session.id)

    const params = await context.params
    const id = params.id

    const automation = await prisma.waAutomation.findFirst({
      where: { id, user_id: userId }
    })

    if (!automation) {
      return NextResponse.json({ error: 'Automation not found' }, { status: 404 })
    }

    const logs = await prisma.waAutomationLog.findMany({
      where: { automation_id: id },
      orderBy: { created_at: 'desc' },
      take: 100,
      include: {
        contact: {
          select: { id: true, name: true, phone: true }
        }
      }
    })

    return NextResponse.json({ automation, logs })
  } catch (error) {
    console.error('Error fetching automation logs:', error)
    return NextResponse.json({ error: 'Failed to fetch logs' }, { status: 500 })
  }
}
