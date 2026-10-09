// Campaign schedules use India time regardless of the browser/VPS timezone.
export const CAMPAIGN_TIME_ZONE = 'Asia/Kolkata'
const INDIA_OFFSET_MS = 330 * 60_000
const DAY_MS = 24 * 60 * 60_000
const CLOCK_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/

export function validateCampaignSchedule(input) {
  const start = input.callingStartTime ?? null
  const end = input.callingEndTime ?? null
  const autoResumeDaily = input.autoResumeDaily ?? false
  if (typeof autoResumeDaily !== 'boolean') throw new Error('Automatic next-day resume must be on or off.')
  if (start === null && end === null) return { callingStartTime: null, callingEndTime: null, autoResumeDaily }
  if (typeof start !== 'string' || typeof end !== 'string' || !CLOCK_TIME.test(start) || !CLOCK_TIME.test(end)) {
    throw new Error('Choose a valid start time and end time (India time).')
  }
  if (start >= end) throw new Error('End time must be later than start time on the same day.')
  return { callingStartTime: start, callingEndTime: end, autoResumeDaily }
}

function scheduleEnabled(campaign) {
  return campaign.callingStartTime != null || campaign.callingEndTime != null
}

function minutes(value) {
  const [hours, mins] = value.split(':').map(Number)
  return hours * 60 + mins
}

export function campaignCallingWindow(campaign, now = new Date()) {
  if (!scheduleEnabled(campaign)) return { enabled: false, open: true, nextStartAt: now, endAt: null }
  // Invalid persisted schedules fail closed in the worker.
  try { validateCampaignSchedule(campaign) } catch {
    return { enabled: true, open: false, nextStartAt: null, endAt: null }
  }
  const timestamp = now.getTime()
  const indiaMidnight = Math.floor((timestamp + INDIA_OFFSET_MS) / DAY_MS) * DAY_MS - INDIA_OFFSET_MS
  const start = indiaMidnight + minutes(campaign.callingStartTime) * 60_000
  const end = indiaMidnight + minutes(campaign.callingEndTime) * 60_000
  const open = timestamp >= start && timestamp < end
  const nextDay = timestamp >= end ? DAY_MS : 0
  return {
    enabled: true, open,
    nextStartAt: new Date(open ? timestamp : start + nextDay),
    endAt: new Date(end + nextDay),
  }
}

export function campaignScheduleActivation(campaign, now = new Date()) {
  const window = campaignCallingWindow(campaign, now)
  return {
    nextCallAt: window.nextStartAt,
    scheduleStopAt: window.enabled && !campaign.autoResumeDaily ? window.endAt : null,
  }
}

export function canStartCampaignCall(campaign, now = new Date()) {
  if (!campaign || campaign.status !== 'RUNNING') return false
  const window = campaignCallingWindow(campaign, now)
  if (!window.open) return false
  if (window.enabled && !campaign.autoResumeDaily) {
    const stopAt = new Date(campaign.scheduleStopAt || 0).getTime()
    if (!Number.isFinite(stopAt) || now.getTime() >= stopAt) return false
  }
  return true
}

export function campaignScheduleDisplay(campaign, activeCalls = 0, now = new Date()) {
  const window = campaignCallingWindow(campaign, now)
  const allowed = canStartCampaignCall(campaign, now)
  let status = campaign.status
  if (campaign.status === 'RUNNING' && window.enabled && !allowed) {
    status = activeCalls > 0 ? 'FINISHING_CALL' : 'WAITING'
  }
  const stopped = window.enabled && !campaign.autoResumeDaily && campaign.scheduleStopAt
    && now.getTime() >= new Date(campaign.scheduleStopAt).getTime()
  return {
    enabled: window.enabled, status, timeZone: CAMPAIGN_TIME_ZONE,
    nextStartAt: campaign.status === 'RUNNING' && !allowed && !stopped ? window.nextStartAt : null,
  }
}
