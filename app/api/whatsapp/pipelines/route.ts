import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth-helpers'
import { DEFAULT_STAGES } from '@/lib/whatsapp/pipeline-rules'
import { ensureDefaultPipeline } from '@/lib/whatsapp/pipeline-leads'

export async function GET() {
    try {
        const session = await getSession()
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const userId = String(session.user.id)

        // Seeded here (under the same lock the webhook uses for new leads)
        // rather than by the browser, so two tabs can't create two pipelines.
        await ensureDefaultPipeline(userId)

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
