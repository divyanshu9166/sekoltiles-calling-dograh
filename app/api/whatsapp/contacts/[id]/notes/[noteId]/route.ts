import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth-helpers'

export async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ id: string; noteId: string }> },
) {
    try {
        const session = await getSession()
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const resolvedParams = await params
        const contactId = String(resolvedParams.id ?? '').trim()
        const noteId = String(resolvedParams.noteId ?? '').trim()
        if (!contactId || !noteId) {
            return NextResponse.json({ error: 'Contact id and note id are required' }, { status: 400 })
        }

        const userId = String(session.user.id)
        const contact = await prisma.waContact.findFirst({
            where: { id: contactId, user_id: userId },
            select: { id: true },
        })
        if (!contact) {
            return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
        }

        const result = await prisma.waContactNote.deleteMany({
            where: { id: noteId, contact_id: contactId },
        })

        if (result.count === 0) {
            return NextResponse.json({ error: 'Note not found' }, { status: 404 })
        }

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting contact note:', error)
        return NextResponse.json({ error: 'Failed to delete note' }, { status: 500 })
    }
}
