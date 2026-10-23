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
        if (body?.contact_id !== undefined)
            updates.contact_id = body.contact_id ? String(body.contact_id) : null
        if (body?.pipeline_id !== undefined) updates.pipeline_id = String(body.pipeline_id)
        if (body?.stage_id !== undefined) updates.stage_id = String(body.stage_id)
        if (body?.assigned_to !== undefined)
            updates.assigned_to = body.assigned_to ? String(body.assigned_to) : null
        if (body?.notes !== undefined)
            updates.notes = body.notes ? String(body.notes) : null
        if (body?.expected_close_date !== undefined)
            updates.expected_close_date = body.expected_close_date
                ? String(body.expected_close_date)
                : null
        if (body?.status !== undefined) updates.status = String(body.status)

        const result = await prisma.waDeal.updateMany({
            where: { id: dealId, user_id: userId },
            data: updates,
        })

        if (result.count === 0) {
            return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
        }

        return NextResponse.json({ success: true })
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
