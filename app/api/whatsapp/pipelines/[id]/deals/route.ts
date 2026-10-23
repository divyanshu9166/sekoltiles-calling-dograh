import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth-helpers'

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const session = await getSession()
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const pipelineId = String((await params).id ?? '').trim()
        if (!pipelineId) {
            return NextResponse.json({ error: 'Pipeline id is required' }, { status: 400 })
        }

        const userId = String(session.user.id)

        const deals = await prisma.waDeal.findMany({
            where: { pipeline_id: pipelineId, user_id: userId },
            include: {
                contact: true,
                assignee: true,
            },
            orderBy: { created_at: 'desc' },
        })

        return NextResponse.json({ data: deals })
    } catch (error) {
        console.error('Error loading pipeline deals:', error)
        return NextResponse.json({ error: 'Failed to load deals' }, { status: 500 })
    }
}
