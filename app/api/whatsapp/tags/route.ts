import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

function serializeTag(tag: {
    id: string
    user_id: string
    name: string
    color: string
    created_at: Date
}) {
    return {
        id: tag.id,
        user_id: tag.user_id,
        name: tag.name,
        color: tag.color,
        created_at: tag.created_at.toISOString(),
    }
}

export async function GET() {
    const session = await getSession()
    if (!session?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = String(session.id)
    const tags = await prisma.waTag.findMany({
        where: { user_id: userId },
        orderBy: { created_at: 'asc' },
    })

    return NextResponse.json({ data: tags.map(serializeTag) })
}

export async function POST(request: Request) {
    const session = await getSession()
    if (!session?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body: { name?: string; color?: string }
    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const name = String(body?.name ?? '').trim()
    const color = String(body?.color ?? '').trim()
    if (!name) {
        return NextResponse.json({ error: 'Tag name is required' }, { status: 400 })
    }
    if (!color) {
        return NextResponse.json({ error: 'Tag color is required' }, { status: 400 })
    }

    const userId = String(session.id)
    const created = await prisma.waTag.create({
        data: {
            user_id: userId,
            name,
            color,
        },
    })

    return NextResponse.json({ data: serializeTag(created) })
}
