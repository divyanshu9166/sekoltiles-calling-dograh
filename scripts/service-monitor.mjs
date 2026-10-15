import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { failureFromLog, failureFromFeedback, classifyServiceFailure, redactDiagnostic } from '../lib/service-alerts/classify.mjs'
import { recordServiceFailure } from '../lib/service-alerts/store.mjs'
import { inspectVobizBalance } from '../lib/service-alerts/vobiz.mjs'

const exec = promisify(execFile)
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required by service monitor')
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4, connectionTimeoutMillis: 5000 })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const secrets = Object.entries(process.env).filter(([key]) => /KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL/.test(key)).map(([, value]) => value)
const base = (process.env.DOGRAH_API_URL || '').replace(/\/+$/, '').replace(/\/api\/v1$/, '') + '/api/v1'
const headers = { 'X-API-Key': process.env.DOGRAH_API_KEY || '' }
const container = process.env.DOGRAH_MONITOR_CONTAINER || 'dograh-api-1'
let stopping = false
let cursor = (await prisma.serviceMonitorState.findUnique({ where: { id: 'providers' } }))?.cursor
  || new Date(Date.now() - 86400000)
let workflowId
let lastBalanceCheck = 0
let balanceDetails = { status: 'NOT_CONFIGURED', message: 'Set VOBIZ_AUTH_ID and VOBIZ_AUTH_TOKEN on the VPS to enable balance checks.' }
const cachedCompleted = new Set()

async function dograh(path) {
  const response = await fetch(base + path, { headers, signal: AbortSignal.timeout(5000) })
  if (!response.ok) throw new Error(`Dograh monitoring API returned HTTP ${response.status}`)
  return response.json()
}

async function collectRuntimeErrors() {
  // Read-only Docker log access. This never changes the call pipeline.
  const { stdout, stderr } = await exec('docker', ['logs', '--timestamps', '--since', cursor.toISOString(), '--tail', '15000', container], { timeout: 8000, maxBuffer: 32 * 1024 * 1024 })
  let latest = cursor
  const failures = new Map()
  for (const line of (stdout + '\n' + stderr).split('\n')) {
    const timestamp = line.match(/^(\d{4}-\d{2}-\d{2}T[^ ]+)/)?.[1]
    if (timestamp) { const date = new Date(timestamp); if (date > latest) latest = date }
    const failure = failureFromLog(line, secrets)
    if (failure) failures.set(failure.eventKey, failure)
  }
  for (const failure of failures.values()) await recordServiceFailure(prisma, failure)
  cursor = latest
}

async function backfillRecentCalls() {
  if (!workflowId) {
    const workflows = await dograh('/workflow/fetch')
    workflowId = workflows.find(w => (w.workflow_uuid || w.uuid) === process.env.DOGRAH_WORKFLOW_UUID)?.id
    if (!workflowId) throw new Error('Configured workflow was not found for monitoring')
  }
  const result = await dograh(`/workflow/${workflowId}/runs?limit=20`)
  // Two completed calls per scan avoids a large startup burst; active runs are
  // always reconsidered, and the live log collector covers immediate failures.
  const candidates = (result.runs || []).filter(r => !cachedCompleted.has(r.id) && new Date(r.created_at) > new Date(Date.now() - 86400000))
  const selected = [...candidates.filter(r => !r.is_completed).slice(0, 3), ...candidates.filter(r => r.is_completed).slice(0, 2)]
  for (const candidate of selected) {
    const run = await dograh(`/workflow/${workflowId}/runs/${candidate.id}`)
    const failures = new Map()
    for (const event of run.logs?.realtime_feedback_events || []) {
      const failure = failureFromFeedback(event, run.id, secrets)
      if (failure) failures.set(failure.eventKey, failure)
    }
    for (const failure of failures.values()) await recordServiceFailure(prisma, failure)
    if (run.is_completed) cachedCompleted.add(run.id)
  }
  if (cachedCompleted.size > 1000) cachedCompleted.clear()
}

async function checkBalance() {
  if (Date.now() - lastBalanceCheck < 60000) return
  lastBalanceCheck = Date.now()
  const id = process.env.VOBIZ_AUTH_ID?.trim()
  const token = process.env.VOBIZ_AUTH_TOKEN?.trim()
  if (!id || !token) return
  try {
    const response = await fetch(`https://api.vobiz.ai/api/v1/Account/${encodeURIComponent(id)}/balance/INR`, {
      headers: { 'X-Auth-ID': id, 'X-Auth-Token': token }, signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) {
      // Avoid persisting the response body: account APIs may echo credentials.
      throw new Error(`Vobiz balance check failed with HTTP ${response.status}`)
    }
    const result = inspectVobizBalance(await response.json())
    balanceDetails = { status: 'CHECKED', ...result.snapshot }
    await recordServiceFailure(prisma, result.failure)
    const codes = [...(result.canResolveCredit ? ['CREDITS_EXHAUSTED'] : []), ...(result.canResolveLowBalance ? ['LOW_BALANCE'] : [])]
    if (codes.length) await prisma.serviceAlert.updateMany({
      where: { service: 'vobiz', code: { in: codes }, status: { not: 'RESOLVED' }, lastSeenAt: { lte: new Date(result.snapshot.checkedAt) } },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    })
  } catch (error) {
    const message = redactDiagnostic(error.message, secrets)
    balanceDetails = { status: 'FAILED', message, checkedAt: new Date().toISOString() }
    await recordServiceFailure(prisma, classifyServiceFailure({ source: 'vobiz', message, secrets }))
  }
}

async function tick() {
  const checks = await Promise.allSettled([collectRuntimeErrors(), backfillRecentCalls(), checkBalance()])
  const issues = checks.map((r, i) => r.status === 'rejected' ? `${['Call log collection', 'Call history sync', 'Balance check'][i]}: ${redactDiagnostic(r.reason?.message, secrets)}` : null).filter(Boolean)
  const details = { logCollectionOnline: checks[0].status === 'fulfilled', historySyncOnline: checks[1].status === 'fulfilled', issues, vobizBalance: balanceDetails }
  await prisma.serviceMonitorState.upsert({ where: { id: 'providers' },
    create: { id: 'providers', heartbeatAt: new Date(), cursor, details },
    update: { heartbeatAt: new Date(), cursor, details },
  })
  if (issues.length) console.warn('[service-monitor] ' + issues.join('; '))
}

process.on('SIGTERM', () => { stopping = true })
process.on('SIGINT', () => { stopping = true })
console.log('[service-monitor] started; observing provider failures without initiating calls')
try {
  while (!stopping) {
    try { await tick() } catch (error) { console.error('[service-monitor] ' + redactDiagnostic(error.message, secrets)) }
    if (!stopping) await new Promise(resolve => setTimeout(resolve, 5000))
  }
} finally { await prisma.$disconnect(); await pool.end() }
