import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth-helpers'

const DEFAULT_STAGES = [
    { name: 'New Lead', color: '#3b82f6', position: 0 },
    { name: 'Qualified', color: '#eab308', position: 1 },
    { name: 'Proposal Sent', color: '#f97316', position: 2 },
    { name: 'Negotiation', color: '#8b5cf6', position: 3 },
    { name: 'Won', color: '#22c55e', position: 4 },
]

export async function GET() {
    try {
        const session = await getSession()
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const userId = String(session.user.id)

        const pipelines = await prisma.waPipeline.findMany({
            where: { user_id: userId },
            orderBy: { created_at: 'asc' },
        })

        return NextResponse.json({ data: pipelines })
    } catch (error) {
        console.error('Error loading pipelines:', error)
        return NextResponse.json({ error: 'Failed to load pipelines' }, { status: 500 })
    }
}

export async function POST(request: Request) {
    try {
        const session = await getSession()
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        let body: { name?: string; seed_default_stages?: boolean }
        try {
            body = await request.json()
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
        }

        const name = String(body?.name ?? '').trim()
        if (!name) {
            return NextResponse.json({ error: 'Pipeline name is required' }, { status: 400 })
        }

        const shouldSeed = body?.seed_default_stages !== false
        const userId = String(session.user.id)

        const pipeline = await prisma.$transaction(async (tx) => {
            const created = await tx.waPipeline.create({
                data: {
                    user_id: userId,
                    name,
                },
            })

            if (shouldSeed) {
                await tx.waPipelineStage.createMany({
                    data: DEFAULT_STAGES.map((stage) => ({
                        pipeline_id: created.id,
                        name: stage.name,
                        color: stage.color,
                        position: stage.position,
                    })),
                })
            }

            return created
        })

        return NextResponse.json({ data: pipeline })
    } catch (error) {
        console.error('Error creating pipeline:', error)
        return NextResponse.json({ error: 'Failed to create pipeline' }, { status: 500 })
    }
}
