import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth-helpers'

/**
 * GET /api/whatsapp/agent/knowledge
 * List all knowledge documents for the current user.
 */
export async function GET() {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = String(session.user.id)
    const docs = await prisma.waKnowledgeDoc.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      include: { _count: { select: { chunks: true } } },
    })

    return NextResponse.json(
      docs.map((d) => ({
        id: d.id,
        title: d.title,
        source_type: d.source_type,
        char_count: d.char_count,
        status: d.status,
        error: d.error,
        chunk_count: d._count.chunks,
        created_at: d.created_at.toISOString(),
        updated_at: d.updated_at.toISOString(),
      })),
    )
  } catch (error) {
    console.error('[agent/knowledge GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/whatsapp/agent/knowledge
 * Upload a new knowledge document and trigger async indexing.
 *
 * Body: { title: string, raw_text: string, source_type?: string }
 */
export async function POST(request: Request) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = String(session.user.id)

    let body: { title?: string; raw_text?: string; source_type?: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { title, raw_text, source_type = 'text' } = body

    if (!title?.trim()) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 })
    }
    if (!raw_text?.trim()) {
      return NextResponse.json({ error: 'raw_text is required' }, { status: 400 })
    }
    if (raw_text.length > 500_000) {
      return NextResponse.json({ error: 'raw_text exceeds 500,000 character limit' }, { status: 400 })
    }

    const doc = await prisma.waKnowledgeDoc.create({
      data: {
        user_id: userId,
        title: title.trim(),
        raw_text,
        char_count: raw_text.length,
        source_type,
        status: 'pending',
      },
    })

    // Trigger async indexing dynamically so ONNX module init errors don't crash the route
    import('@/lib/ai-agent/agent-worker')
      .then((mod) => {
        mod.indexKnowledgeDoc(doc.id).catch((err) =>
          console.error(`[agent/knowledge] indexing failed for doc ${doc.id}:`, err),
        )
      })
      .catch((err) => {
        console.error(`[agent/knowledge] failed to load worker module for doc ${doc.id}:`, err)
        // Mark as error so it doesn't get stuck in pending forever
        prisma.waKnowledgeDoc.update({
          where: { id: doc.id },
          data: { status: 'error', error: err.message ?? 'Module load failed' },
        }).catch(console.error)
      })

    return NextResponse.json({ success: true, id: doc.id, status: 'pending' }, { status: 201 })
  } catch (error: any) {
    console.error('[agent/knowledge POST]', error)
    return NextResponse.json({ 
      error: error?.message ? `Server Error: ${error.message}` : 'Internal server error' 
    }, { status: 500 })
  }
}
