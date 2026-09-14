import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

const requiredEnvironment = ['DATABASE_URL', 'DOGRAH_API_URL', 'DOGRAH_API_KEY', 'DOGRAH_WORKFLOW_UUID']
for (const name of requiredEnvironment) {
  if (!process.env[name]?.trim()) throw new Error(`${name} is required by the campaign worker`)
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
})
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const rawDograhBase = process.env.DOGRAH_API_URL.trim().replace(/\/+$/, '')
const dograhBase = rawDograhBase.endsWith('/api/v1') ? rawDograhBase : `${rawDograhBase}/api/v1`
const dograhHeaders = { 'Content-Type': 'application/json', 'X-API-Key': process.env.DOGRAH_API_KEY.trim() }

function dograhOutboundDialTarget(phoneNumber) {
  if (process.env.DOGRAH_TELEPHONY_PROVIDER?.trim().toLowerCase() !== 'ari') {
    return phoneNumber
  }

  const trunkEndpoint = process.env.DOGRAH_ARI_TRUNK_ENDPOINT?.trim()
  if (!trunkEndpoint) {
    throw new Error('DOGRAH_ARI_TRUNK_ENDPOINT is required when DOGRAH_TELEPHONY_PROVIDER=ari')
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(trunkEndpoint)) {
    throw new Error('DOGRAH_ARI_TRUNK_ENDPOINT is invalid')
  }

  return `PJSIP/${phoneNumber}@${trunkEndpoint}`
}
const pollIntervalMs = 3000
let stopping = false
let workflowId

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function indiaDateString(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const value = type => parts.find(part => part.type === type)?.value
  return `${value('year')}-${value('month')}-${value('day')}`
}

async function dograhRequest(path, init = {}) {
  const response = await fetch(`${dograhBase}${path}`, {
    ...init,
    headers: { ...dograhHeaders, ...init.headers },
    signal: AbortSignal.timeout(15_000),
  })
  const text = await response.text()
  let body
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  if (!response.ok) throw new Error(`Dograh ${response.status}: ${typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body)}`)
  return body
}

async function getWorkflowId() {
  if (workflowId) return workflowId
  const workflows = await dograhRequest('/workflow/fetch')
  const workflow = workflows.find(item => (item.workflow_uuid || item.uuid) === process.env.DOGRAH_WORKFLOW_UUID.trim())
  if (!workflow) throw new Error('Configured Dograh workflow was not found')
  workflowId = workflow.id
  return workflowId
}

function finalCallStatus(run) {
  const context = run.gathered_context || {}
  const value = String(context.call_status || context.mapped_call_disposition || context.call_disposition || '').toLowerCase()
  if (value.includes('busy')) return 'BUSY'
  if (value.includes('no_answer') || value.includes('unanswered')) return 'NO_ANSWER'
  if (value.includes('missed')) return 'MISSED'
  if (value.includes('fail') || value.includes('error') || value.includes('cancel')) return 'FAILED'
  return 'COMPLETED'
}

function runOutcome(run) {
  const context = run.gathered_context || {}
  return String(context.mapped_call_disposition || context.call_disposition || context.call_status || 'Completed')
}

async function finishLead(lead, run) {
  const callStatus = finalCallStatus(run)
  const leadStatus = callStatus === 'COMPLETED' ? 'COMPLETED' : 'FAILED'
  const outcome = runOutcome(run)
  const durationSec = Math.max(0, Math.round(Number(run.cost_info?.call_duration_seconds || 0)))
  const now = new Date()

  await prisma.$transaction([
    prisma.campaignLead.update({
      where: { id: lead.id },
      data: { status: leadStatus, outcome, completedAt: now, lastError: leadStatus === 'FAILED' ? outcome : null },
    }),
    ...(lead.callLogId ? [prisma.callLog.update({
      where: { id: lead.callLogId },
      data: {
        status: callStatus,
        outcome,
        durationSec,
        duration: `${Math.floor(durationSec / 60)}:${String(durationSec % 60).padStart(2, '0')}`,
      },
    })] : []),
    prisma.marketingCampaign.update({
      where: { id: lead.campaignId },
      data: { nextCallAt: new Date(now.getTime() + lead.campaign.interCallDelaySec * 1000) },
    }),
  ])
  console.log(`[campaign-worker] campaign=${lead.campaignId} lead=${lead.id} finished status=${leadStatus}`)
}

async function reconcileActiveLead() {
  const lead = await prisma.campaignLead.findFirst({
    where: { status: 'CALLING' },
    include: { campaign: true },
    orderBy: { startedAt: 'asc' },
  })
  if (!lead) return false

  if (!lead.dograhRunId) {
    const staleBefore = new Date(Date.now() - 2 * 60_000)
    if (lead.startedAt && lead.startedAt < staleBefore) {
      await prisma.campaignLead.update({
        where: { id: lead.id },
        data: { status: 'FAILED', completedAt: new Date(), lastError: 'Worker interrupted before Dograh accepted the call.' },
      })
    }
    return true
  }

  const run = await dograhRequest(`/workflow/${await getWorkflowId()}/runs/${encodeURIComponent(lead.dograhRunId)}`)
  if (run.is_completed) await finishLead(lead, run)
  return true
}

async function completeEmptyCampaigns() {
  const running = await prisma.marketingCampaign.findMany({ where: { status: 'RUNNING' }, select: { id: true } })
  for (const campaign of running) {
    const unfinished = await prisma.campaignLead.count({
      where: { campaignId: campaign.id, status: { in: ['PENDING', 'CALLING'] } },
    })
    if (!unfinished) {
      await prisma.marketingCampaign.update({
        where: { id: campaign.id },
        data: { status: 'COMPLETED', completedAt: new Date(), nextCallAt: null },
      })
      console.log(`[campaign-worker] campaign=${campaign.id} completed`)
    }
  }
}

async function claimNextLead() {
  return prisma.$transaction(async transaction => {
    const campaign = await transaction.marketingCampaign.findFirst({
      where: { status: 'RUNNING', OR: [{ nextCallAt: null }, { nextCallAt: { lte: new Date() } }] },
      orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
    })
    if (!campaign) return null
    const lead = await transaction.campaignLead.findFirst({
      where: { campaignId: campaign.id, status: 'PENDING' },
      orderBy: { id: 'asc' },
    })
    if (!lead) return null
    const claimed = await transaction.campaignLead.updateMany({
      where: { id: lead.id, status: 'PENDING' },
      data: { status: 'CALLING', attempts: { increment: 1 }, startedAt: new Date(), lastError: null },
    })
    return claimed.count === 1 ? { ...lead, campaign } : null
  })
}

async function dialLead(lead) {
  const now = new Date()
  const contact = await prisma.contact.upsert({
    where: { phone: lead.phone },
    update: { name: lead.name },
    create: { name: lead.name, phone: lead.phone },
  })
  const callLog = await prisma.callLog.create({
    data: {
      contactId: contact.id,
      customerName: lead.name,
      phone: lead.phone,
      direction: 'OUTBOUND',
      status: 'QUEUED',
      duration: '0:00',
      durationSec: 0,
      agent: 'AI Agent - Anushka',
      date: now,
      time: now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }),
      purpose: `Bulk campaign: ${lead.campaign.name}`,
      region: lead.region,
      outcome: 'Queued in bulk campaign',
      notes: `Campaign ${lead.campaign.id}, lead ${lead.id}`,
      recording: false,
      callType: 'ai_bulk_campaign',
      aiHandled: true,
    },
  })

  try {
    const greeting = `नमस्ते ${lead.name} जी, मैं अनुष्का, Sekol Tiles से बोल रही हूँ। क्या अभी थोड़ी बात करना सुविधाजनक रहेगा?`
    const run = await dograhRequest(`/public/agent/workflow/${encodeURIComponent(process.env.DOGRAH_WORKFLOW_UUID.trim())}`, {
      method: 'POST',
      body: JSON.stringify({
        phone_number: dograhOutboundDialTarget(lead.phone),
        initial_context: {
          direction: 'outbound',
          phone_number: lead.phone,
          customer_name: lead.name,
          region: lead.region || '',
          reason: `Bulk campaign: ${lead.campaign.name}`,
          campaign_name: lead.campaign.name,
          // Bound legacy campaigns created before the UI/API token guard.
          campaign_instructions: lead.campaign.instructions.slice(0, 2000),
          campaign_id: lead.campaign.id,
          campaign_lead_id: lead.id,
          crm_call_log_id: callLog.id,
          current_india_date: indiaDateString(),
          greeting_override: { type: 'text', text: greeting },
          call_greeting: greeting,
          source: 'sekol-bulk-campaign',
        },
        ...(process.env.DOGRAH_TELEPHONY_CONFIGURATION_ID ? { telephony_configuration_id: Number(process.env.DOGRAH_TELEPHONY_CONFIGURATION_ID) } : {}),
        ...(process.env.DOGRAH_FROM_PHONE_NUMBER_ID ? { from_phone_number_id: Number(process.env.DOGRAH_FROM_PHONE_NUMBER_ID) } : {}),
      }),
    })
    await prisma.$transaction([
      prisma.campaignLead.update({
        where: { id: lead.id },
        data: { dograhRunId: String(run.workflow_run_id), callLogId: callLog.id },
      }),
      prisma.callLog.update({
        where: { id: callLog.id },
        data: { status: 'IN_PROGRESS', dograhRunId: String(run.workflow_run_id), outcome: 'Dograh campaign call initiated' },
      }),
    ])
    console.log(`[campaign-worker] campaign=${lead.campaign.id} lead=${lead.id} dialed run=${run.workflow_run_id}`)
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : 'Dograh could not initiate the call.'
    await prisma.$transaction([
      prisma.campaignLead.update({ where: { id: lead.id }, data: { status: 'FAILED', completedAt: new Date(), lastError: message } }),
      prisma.callLog.update({ where: { id: callLog.id }, data: { status: 'FAILED', outcome: 'Campaign call could not be initiated', notes: message } }),
      prisma.marketingCampaign.update({
        where: { id: lead.campaign.id },
        data: { nextCallAt: new Date(Date.now() + lead.campaign.interCallDelaySec * 1000) },
      }),
    ])
    console.error(`[campaign-worker] campaign=${lead.campaign.id} lead=${lead.id} dial failed: ${message}`)
  }
}

async function tick() {
  if (await reconcileActiveLead()) return
  await completeEmptyCampaigns()
  const lead = await claimNextLead()
  if (lead) await dialLead(lead)
}

async function shutdown() {
  stopping = true
  await prisma.$disconnect().catch(() => {})
  await pool.end().catch(() => {})
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

console.log('[campaign-worker] ready; calls are processed sequentially')
while (!stopping) {
  try { await tick() } catch (error) { console.error('[campaign-worker] tick failed:', error) }
  await sleep(pollIntervalMs)
}
