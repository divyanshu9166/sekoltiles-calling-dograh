import { NextRequest, NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'node:crypto'
import { prisma } from '@/lib/db'
import { classifyServiceFailure } from '@/lib/service-alerts/classify.mjs'
import { recordServiceFailure } from '@/lib/service-alerts/store.mjs'
import { publishServiceAlert } from '@/lib/service-alerts/events'

export async function POST(request: NextRequest) {
  const secret = process.env.SEKOL_ALERT_SECRET
  if (!secret) return NextResponse.json({ error: 'Error reporting is not configured.' }, { status: 503 })
  const digest = (value: string) => createHash('sha256').update(value).digest()
  if (!timingSafeEqual(digest(secret), digest(request.headers.get('x-sekol-alert-secret') || ''))) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
  try {
    const reader = request.body?.getReader()
    if (!reader) return NextResponse.json({ error: 'Missing event.' }, { status: 400 })
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > 16384) { await reader.cancel(); return NextResponse.json({ error: 'Event too large.' }, { status: 413 }) }
      chunks.push(value)
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    const observedAt = new Date(body.timestamp)
    if (!['stt', 'tts', 'llm', 'telephony'].includes(body.source)
      || typeof body.message !== 'string' || !body.message || body.message.length > 4000
      || typeof body.provider !== 'string' || body.provider.length > 80
      || !Number.isFinite(observedAt.getTime()) || Math.abs(Date.now() - observedAt.getTime()) > 600000
      || (body.runId && !/^\d+$/.test(String(body.runId)))) {
      return NextResponse.json({ error: 'Invalid provider event.' }, { status: 400 })
    }
    const failure = classifyServiceFailure({ message: body.message, processor: `${body.source} ${body.provider}`, source: body.source,
      runId: body.runId || null, timestamp: observedAt,
      secrets: [secret, process.env.CRM_API_SECRET, process.env.DOGRAH_API_KEY, process.env.VOBIZ_AUTH_TOKEN] })
    if (!failure) return NextResponse.json({ success: true, ignored: true })
    await recordServiceFailure(prisma, failure)
    const details = { mode: 'EVENT_DRIVEN', enabled: true, lastEventAt: new Date().toISOString() }
    await prisma.serviceMonitorState.upsert({ where: { id: 'providers' }, create: { id: 'providers', heartbeatAt: new Date(), details }, update: { heartbeatAt: new Date(), details } })
    publishServiceAlert()
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
    return NextResponse.json({ error: 'Event could not be saved.' }, { status: 503 })
  }
}
