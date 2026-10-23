import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth-helpers'

export async function GET() {
    try {
        const session = await getSession()
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const userId = String(session.user.id)

        const profiles = await prisma.waProfile.findMany({
            where: { user_id: userId },
            orderBy: { full_name: 'asc' },
        })

        return NextResponse.json({ data: profiles })
    } catch (error) {
        console.error('Error loading profiles:', error)
        return NextResponse.json({ error: 'Failed to load profiles' }, { status: 500 })
    }
}
