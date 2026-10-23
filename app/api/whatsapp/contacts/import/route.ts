import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth-helpers'

interface ImportRow {
    phone?: string
    name?: string
    email?: string
    company?: string
}

export async function POST(request: Request) {
    try {
        const session = await getSession()
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        let body: { rows?: ImportRow[] }
        try {
            body = await request.json()
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
        }

        const rows = Array.isArray(body?.rows) ? body.rows : []
        if (rows.length === 0) {
            return NextResponse.json({ error: 'No rows provided' }, { status: 400 })
        }

        const userId = String(session.user.id)

        let invalid = 0
        const data = rows
            .map((row) => {
                const phone = String(row?.phone ?? '').trim()
                if (!phone) {
                    invalid += 1
                    return null
                }
                return {
                    user_id: userId,
                    phone,
                    name: String(row?.name ?? '').trim() || null,
                    email: String(row?.email ?? '').trim() || null,
                    company: String(row?.company ?? '').trim() || null,
                }
            })
            .filter(Boolean) as Array<{
                user_id: string
                phone: string
                name: string | null
                email: string | null
                company: string | null
            }>

        if (data.length === 0) {
            return NextResponse.json({ error: 'No valid rows found' }, { status: 400 })
        }

        let imported = 0
        let failed = invalid

        try {
            const result = await prisma.waContact.createMany({ data })
            imported = result.count
            failed += data.length - result.count
        } catch (error) {
            for (const row of data) {
                try {
                    await prisma.waContact.create({ data: row })
                    imported += 1
                } catch {
                    failed += 1
                }
            }
            console.error('Bulk import failed, fell back to row inserts:', error)
        }

        return NextResponse.json({ imported, failed })
    } catch (error) {
        console.error('Error importing WA contacts:', error)
        return NextResponse.json({ error: 'Failed to import contacts' }, { status: 500 })
    }
}
