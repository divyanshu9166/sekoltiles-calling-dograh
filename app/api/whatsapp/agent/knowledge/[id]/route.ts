import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth-helpers'

/**
 * DELETE /api/whatsapp/agent/knowledge/[id]
 * Delete a knowledge document and all its chunks (cascade via FK).
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = String(session.user.id)
    const { id } = await params

    // Verify the doc belongs to the authenticated user before deleting
    const doc = await prisma.waKnowledgeDoc.findUnique({
      where: { id },
      select: { user_id: true },
    })

    if (!doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }
    if (doc.user_id !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Chunks are deleted via cascade FK (onDelete: Cascade in schema)
    await prisma.waKnowledgeDoc.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[agent/knowledge/[id] DELETE]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/whatsapp/agent/knowledge/[id]
 * Re-index a document (useful after editing or if indexing failed).
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = String(session.user.id)
    const { id } = await params

    const doc = await prisma.waKnowledgeDoc.findUnique({
      where: { id },
      select: { user_id: true },
    })

    if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    if (doc.user_id !== userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    // Trigger re-index async
    const { indexKnowledgeDoc } = await import('@/lib/ai-agent/agent-worker')
    indexKnowledgeDoc(id).catch((err) =>
      console.error(`[agent/knowledge] re-index failed for doc ${id}:`, err),
    )

    return NextResponse.json({ success: true, status: 'pending' })
  } catch (error) {
    console.error('[agent/knowledge/[id] POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
