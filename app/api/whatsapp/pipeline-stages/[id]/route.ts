import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth-helpers'

export async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const session = await getSession()
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const stageId = String((await params).id ?? '').trim()
        if (!stageId) {
            return NextResponse.json({ error: 'Stage id is required' }, { status: 400 })
        }

        const userId = String(session.user.id)

        const stage = await prisma.waPipelineStage.findFirst({
            where: {
                id: stageId,
                pipeline: { user_id: userId },
            },
            select: { id: true },
        })

        if (!stage) {
            return NextResponse.json({ error: 'Stage not found' }, { status: 404 })
        }

        const dealCount = await prisma.waDeal.count({
            where: { stage_id: stageId, user_id: userId },
        })

        if (dealCount > 0) {
            return NextResponse.json(
                { error: 'Move or delete deals in this stage first' },
                { status: 400 },
            )
        }

        await prisma.waPipelineStage.delete({ where: { id: stageId } })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting stage:', error)
        return NextResponse.json({ error: 'Failed to delete stage' }, { status: 500 })
    }
}
