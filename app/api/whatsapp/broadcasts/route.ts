import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

export async function POST(request: Request) {
  try {
    const session = await getSession()
    if (!session?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = String(session.id)

    const payload = await request.json()
    const { name, template, audience, variables } = payload

    const broadcast = await prisma.waBroadcast.create({
      data: {
        user_id: userId,
        name,
        template_name: template.name,
        template_language: template.language ?? 'en_US',
        template_variables: variables ?? {},
        audience_filter: audience,
        status: 'draft',
        total_recipients: 0,
        sent_count: 0,
        delivered_count: 0,
        read_count: 0,
        replied_count: 0,
        failed_count: 0,
      }
    })

    return NextResponse.json({ success: true, broadcastId: broadcast.id })
  } catch (error) {
    console.error('Error saving draft broadcast:', error)
    return NextResponse.json({ error: 'Failed to save draft' }, { status: 500 })
  }
}
