import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

export async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const session = await getSession()
    if (!session?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const id = String((await params).id ?? '').trim()
    if (!id) {
        return NextResponse.json({ error: 'Template id is required' }, { status: 400 })
    }

    const userId = String(session.id)
    const existing = await prisma.waMessageTemplate.findFirst({
        where: { id, user_id: userId },
        select: { id: true },
    })

    if (!existing) {
        return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    await prisma.waMessageTemplate.delete({ where: { id: existing.id } })

    return NextResponse.json({ success: true })
}
