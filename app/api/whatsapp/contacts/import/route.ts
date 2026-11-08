import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth-helpers'
import { contactRows, IMPORT_BATCH_SIZE } from '@/lib/whatsapp/contact-import'

interface ImportRow {
    phone?: string
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
        // Big sheets arrive in batches from the import dialog.
        if (rows.length > IMPORT_BATCH_SIZE) {
            return NextResponse.json(
                { error: `Send at most ${IMPORT_BATCH_SIZE} contacts per request.` },
                { status: 413 },
            )
        }
        let validated
        try {
            validated = contactRows([['company', 'phone'], ...rows.map(row => [row?.company, row?.phone])])
        } catch (error) {
            return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid contacts' }, { status: 400 })
        }

        const userId = String(session.user.id)

        // Skip numbers this account already has (stored with or without "+")
        // and repeats within the batch, so re-importing a sheet adds no copies.
        const phones = validated.map((row) => row.phone)
        const existingRows = await prisma.waContact.findMany({
            where: { user_id: userId, phone: { in: [...phones, ...phones.map((p) => `+${p}`)] } },
            select: { phone: true },
        })
        const known = new Set(existingRows.map((row) => row.phone.replace(/^\+/, '')))
        let existing = 0

        let invalid = 0
        const data = validated
            .map((row) => {
                const phone = String(row?.phone ?? '').trim()
                if (!phone) {
                    invalid += 1
                    return null
                }
                if (known.has(phone)) {
                    existing += 1
                    return null
                }
                known.add(phone)
                return {
                    user_id: userId,
                    phone,
                    name: row.company,
                    email: null,
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
            if (existing > 0) return NextResponse.json({ imported: 0, failed: invalid, existing })
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

        return NextResponse.json({ imported, failed, existing })
    } catch (error) {
        console.error('Error importing WA contacts:', error)
        return NextResponse.json({ error: 'Failed to import contacts' }, { status: 500 })
    }
}
