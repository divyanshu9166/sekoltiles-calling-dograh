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
        const pipeline = await prisma.waPipeline.findFirst({
            where: { id: pipelineId, user_id: userId },
            select: { id: true },
        })

        if (!pipeline) {
            return NextResponse.json({ error: 'Pipeline not found' }, { status: 404 })
        }

        const stages = await prisma.waPipelineStage.findMany({
            where: { pipeline_id: pipelineId },
            orderBy: { position: 'asc' },
        })

        return NextResponse.json({ data: stages })
    } catch (error) {
        console.error('Error loading pipeline stages:', error)
        return NextResponse.json({ error: 'Failed to load stages' }, { status: 500 })
    }
}

export async function POST(
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

        let body: { name?: string; color?: string; position?: number }
        try {
            body = await request.json()
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
        }

        const name = String(body?.name ?? '').trim()
        const color = String(body?.color ?? '').trim()
        if (!name || !color) {
            return NextResponse.json({ error: 'Stage name and color are required' }, { status: 400 })
        }

        const userId = String(session.user.id)
        const pipeline = await prisma.waPipeline.findFirst({
            where: { id: pipelineId, user_id: userId },
            select: { id: true },
        })

        if (!pipeline) {
            return NextResponse.json({ error: 'Pipeline not found' }, { status: 404 })
        }

        const position =
            typeof body?.position === 'number'
                ? body.position
                : await prisma.waPipelineStage.count({ where: { pipeline_id: pipelineId } })

        const stage = await prisma.waPipelineStage.create({
            data: {
                pipeline_id: pipelineId,
                name,
                color,
                position,
            },
        })

        return NextResponse.json({ data: stage })
    } catch (error) {
        console.error('Error creating pipeline stage:', error)
        return NextResponse.json({ error: 'Failed to create stage' }, { status: 500 })
    }
}
