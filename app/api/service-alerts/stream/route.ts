import { NextRequest } from 'next/server'
import { getCurrentAdmin } from '@/lib/auth'
import { subscribeServiceAlerts } from '@/lib/service-alerts/events'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (!await getCurrentAdmin()) return Response.json({ error: 'Unauthorized.' }, { status: 401 })
  const encoder = new TextEncoder()
  let unsubscribe = () => {}
  let close = () => {}
  const stream = new ReadableStream({
    start(controller) {
      let closed = false
      const send = (value: string) => { if (!closed) controller.enqueue(encoder.encode(value)) }
      send('retry: 30000\nevent: ready\ndata: {}\n\n')
      unsubscribe = subscribeServiceAlerts(() => { send('event: changed\ndata: {}\n\n') })
      close = () => { if (closed) return; closed = true; unsubscribe(); controller.close() }
      request.signal.addEventListener('abort', close, { once: true })
      if (request.signal.aborted) close()
    },
    cancel() { unsubscribe(); request.signal.removeEventListener('abort', close) },
  })
  // Passive push only: no heartbeat timer, DB polling or provider API probes.
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-store', 'X-Accel-Buffering': 'no' } })
}
