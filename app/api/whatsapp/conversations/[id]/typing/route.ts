import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth-helpers'
import { markConversationRead } from '@/lib/whatsapp/read-receipts'

/**
 * Shows "typing…" to the customer while an agent writes a reply. WhatsApp
 * clears it when the reply arrives or after 25 seconds, so the composer
 * calls this at most every 20 seconds while the agent keeps typing.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const conversationId = String((await params).id ?? '').trim()
  if (!conversationId) {
    return NextResponse.json({ error: 'Conversation id is required' }, { status: 400 })
  }

  const shown = await markConversationRead({
    userId: String(session.user.id),
    conversationId,
    typing: true,
  })
  return NextResponse.json({ shown })
}
