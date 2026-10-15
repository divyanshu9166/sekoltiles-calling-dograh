import { NextRequest, NextResponse } from 'next/server'
import { getCurrentAdmin } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { publishServiceAlert } from '@/lib/service-alerts/events'

const noCache = { 'Cache-Control': 'no-store, private' }

export async function GET() {
  if (!await getCurrentAdmin()) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401, headers: noCache })
  try {
    const [active, history, monitor] = await Promise.all([
      prisma.serviceAlert.findMany({ where: { status: { not: 'RESOLVED' } }, orderBy: { lastSeenAt: 'desc' }, include: { events: { orderBy: { observedAt: 'desc' }, take: 5 } } }),
      prisma.serviceAlert.findMany({ where: { status: 'RESOLVED' }, orderBy: { resolvedAt: 'desc' }, take: 20, include: { events: { orderBy: { observedAt: 'desc' }, take: 3 } } }),
      prisma.serviceMonitorState.findUnique({ where: { id: 'providers' } }),
    ])
    const alerts = [...active, ...history]
    const runIds = [...new Set(alerts.flatMap(a => a.events.flatMap(e => e.runId ? [e.runId] : [])))]
    const calls = runIds.length ? await prisma.callLog.findMany({ where: { dograhRunId: { in: runIds }, deletedAt: null }, select: { id: true, dograhRunId: true, customerName: true, direction: true } }) : []
    const callByRun = new Map(calls.map(c => [c.dograhRunId, c]))
    const details = (monitor?.details || {}) as { mode?: string; enabled?: boolean; lastEventAt?: string }
    const configured = details.mode === 'EVENT_DRIVEN' && details.enabled === true && !!process.env.SEKOL_ALERT_SECRET
    return NextResponse.json({
      success: true, activeCount: active.length, criticalCount: active.filter(a => a.severity === 'CRITICAL').length,
      monitor: { mode: 'EVENT_DRIVEN', online: configured, heartbeatAt: details.lastEventAt || null,
        details: { mode: 'EVENT_DRIVEN', enabled: configured, lastEventAt: details.lastEventAt || null } },
      alerts: alerts.map(a => ({ ...a, events: a.events.map(e => ({ ...e, call: e.runId ? callByRun.get(e.runId) || null : null })) })),
    }, { headers: noCache })
  } catch {
    return NextResponse.json({ error: 'Service alerts could not be loaded. Monitoring status is unknown.' }, { status: 503, headers: noCache })
  }
}

export async function PATCH(request: NextRequest) {
  if (!await getCurrentAdmin()) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401, headers: noCache })
  try {
    const body = await request.json()
    if (!Number.isSafeInteger(body.id) || body.id <= 0 || !['acknowledge', 'resolve'].includes(body.action)) {
      return NextResponse.json({ error: 'Invalid alert action.' }, { status: 400 })
    }
    // Guard against resolving a newer failure that arrived after the user read it.
    const observed = new Date(body.lastSeenAt)
    if (!Number.isFinite(observed.getTime())) return NextResponse.json({ error: 'Reload the alert before updating it.' }, { status: 400 })
    const updated = await prisma.serviceAlert.updateMany({
      where: { id: body.id, lastSeenAt: observed, status: { not: 'RESOLVED' } },
      data: body.action === 'acknowledge' ? { status: 'ACKNOWLEDGED', acknowledgedAt: new Date() } : { status: 'RESOLVED', resolvedAt: new Date() },
    })
    if (!updated.count) return NextResponse.json({ error: 'This alert changed. Refresh and review its latest details.' }, { status: 409 })
    publishServiceAlert()
    return NextResponse.json({ success: true }, { headers: noCache })
  } catch {
    return NextResponse.json({ error: 'The alert could not be updated.' }, { status: 400 })
  }
}
