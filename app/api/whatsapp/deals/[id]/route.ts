import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth-helpers'
import { parseDealDate, statusForStageMove } from '@/lib/whatsapp/pipeline-rules'

const DEAL_STATUSES = new Set(['open', 'won', 'lost'])

export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const session = await getSession()
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const dealId = String((await params).id ?? '').trim()
        if (!dealId) {
            return NextResponse.json({ error: 'Deal id is required' }, { status: 400 })
        }

        let body: {
            title?: string
            value?: number
            currency?: string
            contact_id?: string | null
            pipeline_id?: string
            stage_id?: string
            assigned_to?: string | null
            notes?: string | null
            expected_close_date?: string | null
            status?: string
        }
        try {
            body = await request.json()
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
        }

        const userId = String(session.user.id)

        const updates: Record<string, unknown> = {}
        if (body?.title !== undefined) updates.title = String(body.title).trim()
        if (body?.value !== undefined)
            updates.value = typeof body.value === 'number' ? body.value : Number(body.value) || 0
        if (body?.currency !== undefined) updates.currency = String(body.currency)
        if (body?.assigned_to !== undefined)
            updates.assigned_to = body.assigned_to ? String(body.assigned_to) : null
        if (body?.notes !== undefined)
            updates.notes = body.notes ? String(body.notes) : null
        if (body?.expected_close_date !== undefined) {
            const expectedClose = parseDealDate(body.expected_close_date)
            if (expectedClose === undefined) {
                return NextResponse.json({ error: 'Invalid expected close date' }, { status: 400 })
            }
            updates.expected_close_date = expectedClose
        }
        if (body?.status !== undefined) {
            if (!DEAL_STATUSES.has(String(body.status))) {
                return NextResponse.json({ error: 'Invalid deal status' }, { status: 400 })
            }
            updates.status = String(body.status)
        }

        const existing = await prisma.waDeal.findFirst({
            where: { id: dealId, user_id: userId },
            select: { pipeline_id: true, stage_id: true, status: true },
        })
        if (!existing) {
            return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
        }

        if (body?.contact_id !== undefined) {
            const contactId = body.contact_id ? String(body.contact_id) : null
            if (contactId) {
                const contact = await prisma.waContact.findFirst({
                    where: { id: contactId, user_id: userId },
                    select: { id: true },
                })
                if (!contact) {
                    return NextResponse.json({ error: 'Contact not found' }, { status: 400 })
                }
            }
            updates.contact_id = contactId
        }

        // The stage must belong to the deal's (possibly new) pipeline.
        const pipelineId = body?.pipeline_id !== undefined ? String(body.pipeline_id) : existing.pipeline_id
        const stageId = body?.stage_id !== undefined ? String(body.stage_id) : existing.stage_id
        if (pipelineId !== existing.pipeline_id || stageId !== existing.stage_id) {
            const stage = await prisma.waPipelineStage.findFirst({
                where: { id: stageId, pipeline_id: pipelineId, pipeline: { user_id: userId } },
                select: { name: true },
            })
            if (!stage) {
                return NextResponse.json({ error: 'Stage not found in this pipeline' }, { status: 400 })
            }
            updates.pipeline_id = pipelineId
            updates.stage_id = stageId
            // Dragging into "Won" closes the deal; dragging out reopens it,
            // unless the caller set the status explicitly.
            if (updates.status === undefined) {
                const status = statusForStageMove(existing.status, stage)
                if (status) updates.status = status
            }
        }

        const updated = await prisma.waDeal.update({
            where: { id: dealId },
            data: updates,
            select: { id: true, pipeline_id: true, stage_id: true, status: true, updated_at: true },
        })

        return NextResponse.json({ success: true, data: updated })
    } catch (error) {
        console.error('Error updating deal:', error)
        return NextResponse.json({ error: 'Failed to update deal' }, { status: 500 })
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

        const dealId = String((await params).id ?? '').trim()
        if (!dealId) {
            return NextResponse.json({ error: 'Deal id is required' }, { status: 400 })
        }

        const userId = String(session.user.id)

        const result = await prisma.waDeal.deleteMany({
            where: { id: dealId, user_id: userId },
        })

        if (result.count === 0) {
            return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
        }

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting deal:', error)
        return NextResponse.json({ error: 'Failed to delete deal' }, { status: 500 })
    }
}
