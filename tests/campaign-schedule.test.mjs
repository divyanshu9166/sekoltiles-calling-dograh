import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as schedule from '../lib/campaigns/schedule.mjs'

const at = time => new Date(`2026-10-09T${time}+05:30`)
const base = { id: 1, status: 'RUNNING', callingStartTime: '10:00', callingEndTime: '17:00', autoResumeDaily: false }
const manual = { ...base, ...schedule.campaignScheduleActivation(base, at('09:00:00')) }

test('India time boundaries: start inclusive, end exclusive', () => {
  for (const [time, allowed] of [['09:59:59', false], ['10:00:00', true], ['16:59:59', true], ['17:00:00', false], ['17:04:00', false]]) {
    assert.equal(schedule.canStartCampaignCall(manual, at(time)), allowed, time)
  }
  assert.equal(schedule.canStartCampaignCall(manual, new Date('2026-10-09T04:30:00Z')), true)
})

test('manual resume expires, automatic resume works the following day', () => {
  const tomorrow = new Date('2026-10-10T10:00:00+05:30')
  assert.equal(schedule.canStartCampaignCall(manual, tomorrow), false)
  assert.equal(schedule.canStartCampaignCall({ ...manual, autoResumeDaily: true }, tomorrow), true)
  assert.equal(schedule.canStartCampaignCall({ ...manual, autoResumeDaily: true, status: 'PAUSED' }, tomorrow), false)
  const rearmed = { ...manual, ...schedule.campaignScheduleActivation(manual, tomorrow) }
  assert.equal(schedule.canStartCampaignCall(rearmed, tomorrow), true)
})

test('starting after closing arms the next window, including year rollover', () => {
  const activation = schedule.campaignScheduleActivation(base, new Date('2026-12-31T17:04:00+05:30'))
  assert.equal(activation.nextCallAt.toISOString(), '2027-01-01T04:30:00.000Z')
  assert.equal(activation.scheduleStopAt.toISOString(), '2027-01-01T11:30:00.000Z')
})

test('editable times are used; disabled legacy campaigns remain unrestricted', () => {
  const custom = { ...base, callingStartTime: '11:15', callingEndTime: '14:30', autoResumeDaily: true }
  assert.equal(schedule.canStartCampaignCall(custom, at('11:14:59')), false)
  assert.equal(schedule.canStartCampaignCall(custom, at('11:15:00')), true)
  assert.equal(schedule.canStartCampaignCall(custom, at('14:30:00')), false)
  assert.equal(schedule.canStartCampaignCall({ status: 'RUNNING' }, at('23:00:00')), true)
})

test('invalid or partial schedules fail validation and never dial', () => {
  for (const changes of [
    { callingStartTime: '24:00' }, { callingEndTime: null }, { callingStartTime: '9:00' },
    { callingStartTime: '17:00' }, { callingEndTime: '09:00' }, { autoResumeDaily: 'true' },
  ]) {
    assert.throws(() => schedule.validateCampaignSchedule({ ...base, ...changes }))
    assert.equal(schedule.canStartCampaignCall({ ...base, ...changes }, at('12:00:00')), false)
  }
  assert.deepEqual(schedule.validateCampaignSchedule({}), { callingStartTime: null, callingEndTime: null, autoResumeDaily: false })
})

test('UI reports finishing call or next scheduled start without changing campaign status', () => {
  const auto = { ...base, autoResumeDaily: true }
  assert.equal(schedule.campaignScheduleDisplay(auto, 1, at('17:04:00')).status, 'FINISHING_CALL')
  const waiting = schedule.campaignScheduleDisplay(auto, 0, at('17:04:00'))
  assert.equal(waiting.status, 'WAITING')
  assert.equal(waiting.nextStartAt.toISOString(), '2026-10-10T04:30:00.000Z')
  assert.equal(schedule.campaignScheduleDisplay(manual, 0, at('17:04:00')).nextStartAt, null)
})

// Execute the real worker's scheduling/dial functions with an isolated clock and
// in-memory DB. Never imports worker startup, connects to a DB, or makes a call.
const workerSource = readFileSync(new URL('../scripts/campaign-worker.mjs', import.meta.url), 'utf8')
const workerFunctions = workerSource.slice(workerSource.indexOf('async function completeEmptyCampaigns()'), workerSource.indexOf('async function shutdown()'))
function workerHarness(time, campaigns, active = false) {
  let now = at(time)
  const events = []
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now.getTime()])) }
    static now() { return now.getTime() }
  }
  const prisma = {
    marketingCampaign: {
      findMany: async args => args.select ? [] : campaigns,
      findUnique: async ({ where }) => campaigns.find(c => c.id === where.id),
      updateMany: async ({ where, data }) => {
        events.push(['expire', where])
        for (const c of campaigns) if (c.status === 'RUNNING' && !c.autoResumeDaily && c.scheduleStopAt && c.scheduleStopAt <= now) Object.assign(c, data)
      },
    },
    campaignLead: {
      findFirst: async ({ where }) => ({ id: where.campaignId * 10, phone: '+911234567890', name: 'Test' }),
      updateMany: async args => { events.push(['claim', args]); return { count: 1 } },
      update: async args => { events.push(['release', args]); return {} },
    },
    contact: { upsert: async () => ({ id: 1 }) },
    callLog: { create: async () => { events.push(['log']); return { id: 1 } } },
    $transaction: async callback => callback(prisma),
  }
  const factory = new Function('prisma', 'Date', 'canStartCampaignCall', 'reconcileActiveLead', 'sanitizeCustomerName', 'dograhRequest', `${workerFunctions}; return { tick, claimNextLead, dialLead, pauseExpiredCampaigns }`)
  const worker = factory(prisma, Clock, c => schedule.canStartCampaignCall(c, now), async () => active,
    name => name, async () => { throw new Error('Test must never place a call') })
  return { ...worker, events, prisma, setTime: time => { now = at(time) } }
}

test('worker leaves an active 4:59 call alone after 5 PM', async () => {
  const campaign = { ...manual }
  const harness = workerHarness('17:04:00', [campaign], true)
  await harness.tick()
  assert.deepEqual(harness.events, [])
  assert.equal(campaign.status, 'RUNNING')
})

test('after that call finishes, worker pauses manual schedule without claiming another lead', async () => {
  const campaign = { ...manual }
  const harness = workerHarness('17:04:00', [campaign])
  await harness.tick()
  assert.equal(campaign.status, 'PAUSED')
  assert.deepEqual(harness.events.map(e => e[0]), ['expire'])
})

test('auto schedule waits after closing without consuming the pending queue', async () => {
  const campaign = { ...manual, autoResumeDaily: true }
  const harness = workerHarness('17:04:00', [campaign])
  await harness.tick()
  assert.equal(campaign.status, 'RUNNING')
  assert.deepEqual(harness.events.map(e => e[0]), ['expire'])
})

test('waiting campaign does not block another eligible campaign', async () => {
  const harness = workerHarness('17:04:00', [{ ...manual, autoResumeDaily: true }, { id: 2, status: 'RUNNING' }])
  const lead = await harness.claimNextLead()
  assert.equal(lead.campaign.id, 2)
})

test('closing between claim and dial releases the lead, not FAILED and no provider request', async () => {
  const harness = workerHarness('16:59:59', [{ ...manual }])
  const lead = await harness.claimNextLead()
  harness.setTime('17:00:00')
  await harness.dialLead(lead)
  const release = harness.events.find(e => e[0] === 'release')[1].data
  assert.equal(release.status, 'PENDING')
  assert.deepEqual(release.attempts, { decrement: 1 })
  assert.equal(release.lastError, 'Waiting for campaign calling window')
})

test('manual pause between claim and dial also blocks the provider request', async () => {
  const campaign = { ...manual }
  const harness = workerHarness('12:00:00', [campaign])
  const lead = await harness.claimNextLead()
  campaign.status = 'PAUSED'
  await harness.dialLead(lead)
  assert.equal(harness.events.find(e => e[0] === 'release')[1].data.status, 'PENDING')
})
