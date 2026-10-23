import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth-helpers'
import { importWhatsAppLeads } from '@/lib/whatsapp/pipeline-leads'

// Adds every WhatsApp contact who has messaged but never had a deal to the
// first stage of this pipeline. Safe to run repeatedly.
export async function POST(
    _request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const session = await getSession()
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const pipelineId = String((await params).id ?? '').trim()
        const created = await importWhatsAppLeads(String(session.user.id), pipelineId)
        if (created === null) {
            return NextResponse.json({ error: 'Pipeline not found or has no stages' }, { status: 404 })
        }

        return NextResponse.json({ data: { created } })
    } catch (error) {
        console.error('Error importing WhatsApp leads:', error)
        return NextResponse.json({ error: 'Failed to import leads' }, { status: 500 })
    }
}
