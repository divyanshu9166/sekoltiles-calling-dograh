import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth-helpers'

function serializeNote(note: {
    id: string
    contact_id: string
    user_id: string
    note_text: string
    created_at: Date
}) {
    return {
        id: note.id,
        contact_id: note.contact_id,
        user_id: note.user_id,
        note_text: note.note_text,
        created_at: note.created_at.toISOString(),
    }
}

async function ensureContact(userId: string, contactId: string) {
    return prisma.waContact.findFirst({
        where: { id: contactId, user_id: userId },
        select: { id: true },
    })
}

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const session = await getSession()
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const contactId = String((await params).id ?? '').trim()
        if (!contactId) {
            return NextResponse.json({ error: 'Contact id is required' }, { status: 400 })
        }

        const userId = String(session.user.id)
        const contact = await ensureContact(userId, contactId)
        if (!contact) {
            return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
        }

        const notes = await prisma.waContactNote.findMany({
            where: { contact_id: contactId },
            orderBy: { created_at: 'desc' },
        })

        return NextResponse.json({ data: notes.map(serializeNote) })
    } catch (error) {
        console.error('Error loading contact notes:', error)
        return NextResponse.json({ error: 'Failed to load notes' }, { status: 500 })
    }
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const session = await getSession()
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const contactId = String((await params).id ?? '').trim()
        if (!contactId) {
            return NextResponse.json({ error: 'Contact id is required' }, { status: 400 })
        }

        let body: { note_text?: string }
        try {
            body = await request.json()
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
        }

        const noteText = String(body?.note_text ?? '').trim()
        if (!noteText) {
            return NextResponse.json({ error: 'Note text is required' }, { status: 400 })
        }

        const userId = String(session.user.id)
        const contact = await ensureContact(userId, contactId)
        if (!contact) {
            return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
        }

        const note = await prisma.waContactNote.create({
            data: {
                contact_id: contactId,
                user_id: userId,
                note_text: noteText,
            },
        })

        return NextResponse.json({ data: serializeNote(note) })
    } catch (error) {
        console.error('Error creating contact note:', error)
        return NextResponse.json({ error: 'Failed to add note' }, { status: 500 })
    }
}
