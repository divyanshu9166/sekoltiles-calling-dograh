import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth-helpers'

function serializeField(field: {
    id: string
    user_id: string
    field_name: string
    field_type: string
    field_options: unknown
    created_at: Date
}) {
    return {
        id: field.id,
        user_id: field.user_id,
        field_name: field.field_name,
        field_type: field.field_type,
        field_options: field.field_options,
        created_at: field.created_at.toISOString(),
    }
}

export async function GET() {
    try {
        const session = await getSession()
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const userId = String(session.user.id)

        const fields = await prisma.waCustomField.findMany({
            where: { user_id: userId },
            orderBy: { field_name: 'asc' },
        })

        return NextResponse.json({ data: fields.map(serializeField) })
    } catch (error) {
        console.error('Error loading custom fields:', error)
        return NextResponse.json({ error: 'Failed to load custom fields' }, { status: 500 })
    }
}
