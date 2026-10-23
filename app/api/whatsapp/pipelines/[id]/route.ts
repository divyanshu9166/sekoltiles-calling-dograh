import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth-helpers'

export async function PUT(
    request: Request,
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

        let body: {
            name?: string
            stages?: Array<{ id: string; name: string; color: string; position?: number }>
        }
        try {
            body = await request.json()
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
        }

        const userId = String(session.user.id)
        const pipeline = await prisma.waPipeline.findFirst({
            where: { id: pipelineId, user_id: userId },
            select: { id: true },
        })

        if (!pipeline) {
            return NextResponse.json({ error: 'Pipeline not found' }, { status: 404 })
        }

        await prisma.$transaction(async (tx) => {
            if (body?.name !== undefined) {
                const name = String(body.name ?? '').trim()
                if (!name) {
                    throw new Error('Pipeline name is required')
                }
                await tx.waPipeline.update({
                    where: { id: pipelineId },
                    data: { name },
                })
            }

            if (Array.isArray(body?.stages)) {
                await Promise.all(
                    body.stages.map((stage, index) => {
                        const position =
                            typeof stage.position === 'number' ? stage.position : index
                        return tx.waPipelineStage.updateMany({
                            where: { id: stage.id, pipeline_id: pipelineId },
                            data: {
                                name: stage.name,
                                color: stage.color,
                                position,
                            },
                        })
                    }),
                )
            }
        })

        return NextResponse.json({ success: true })
    } catch (error) {
        const message =
            error instanceof Error && error.message === 'Pipeline name is required'
                ? error.message
                : 'Failed to update pipeline'
        console.error('Error updating pipeline:', error)
        return NextResponse.json({ error: message }, { status: 500 })
    }
}

export async function DELETE(
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

        const result = await prisma.waPipeline.deleteMany({
            where: { id: pipelineId, user_id: userId },
        })

        if (result.count === 0) {
            return NextResponse.json({ error: 'Pipeline not found' }, { status: 404 })
        }

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting pipeline:', error)
        return NextResponse.json({ error: 'Failed to delete pipeline' }, { status: 500 })
    }
}
