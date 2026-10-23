import type {
  Automation,
  AutomationLogStepResult,
  AutomationStep,
  AutomationTriggerType,
  ConditionStepConfig,
  KeywordMatchTriggerConfig,
  SendMessageStepConfig,
  SendTemplateStepConfig,
  SendWebhookStepConfig,
  TagStepConfig,
  UpdateContactFieldStepConfig,
  WaitStepConfig,
  CreateDealStepConfig,
  AssignConversationStepConfig,
} from '@/types'
import { prisma } from '@/lib/db'
import { engineSendText, engineSendTemplate } from './meta-send'

// ------------------------------------------------------------
// Public API
// ------------------------------------------------------------

export interface AutomationContext {
  message_text?: string
  conversation_id?: string
  vars?: Record<string, unknown>
  tag_id?: string
  agent_id?: string
}

export interface DispatchInput {
  userId: string
  triggerType: AutomationTriggerType
  contactId?: string | null
  context?: AutomationContext
}

export async function runAutomationsForTrigger(input: DispatchInput): Promise<void> {
  try {
    const automations = await prisma.waAutomation.findMany({
      where: {
        user_id: input.userId,
        trigger_type: input.triggerType,
        is_active: true
      }
    })

    if (!automations || automations.length === 0) return

    for (const automation of automations) {
      if (!triggerMatches(automation as any, input.context)) continue
      try {
        await executeAutomation(automation as any, input)
      } catch (err) {
        console.error('[automations] execute failed:', automation.id, err)
      }
    }
  } catch (err) {
    console.error('[automations] dispatch failed:', err)
  }
}

/**
 * Check synchronously if an inbound message matches any active keyword automations.
 * This is used by the webhook to decide whether to skip queueing the AI agent.
 */
export async function hasMatchingKeywordAutomation(userId: string, text: string): Promise<boolean> {
  if (!text) return false

  const automations = await prisma.waAutomation.findMany({
    where: {
      user_id: userId,
      trigger_type: 'keyword_match',
      is_active: true
    }
  })

  if (!automations || automations.length === 0) return false

  for (const automation of automations) {
    if (triggerMatches(automation as any, { message_text: text })) {
      return true
    }
  }

  return false
}

export async function resumePendingExecution(pending: {
  id: string
  automation_id: string
  user_id: string
  contact_id: string | null
  log_id: string | null
  parent_step_id: string | null
  branch: 'yes' | 'no' | null
  next_step_position: number
  context: AutomationContext
}): Promise<void> {
  const automation = await prisma.waAutomation.findUnique({
    where: { id: pending.automation_id }
  })

  if (!automation) {
    console.error('[automations] resume: missing automation', pending.automation_id)
    await markPending(pending.id, 'failed')
    return
  }

  try {
    await executeStepsFrom({
      automation: automation as any,
      contactId: pending.contact_id,
      context: pending.context ?? {},
      parentStepId: pending.parent_step_id,
      branch: pending.branch,
      startPosition: pending.next_step_position,
      logId: pending.log_id,
      triggerEvent: 'resumed_wait',
    })
    await markPending(pending.id, 'done')
  } catch (err) {
    console.error('[automations] resume failed:', err)
    await markPending(pending.id, 'failed')
  }
}

// ------------------------------------------------------------
// Internal execution
// ------------------------------------------------------------

async function executeAutomation(automation: Automation, input: DispatchInput) {
  try {
    const log = await prisma.waAutomationLog.create({
      data: {
        automation_id: automation.id,
        user_id: automation.user_id,
        contact_id: input.contactId ?? null,
        trigger_event: input.triggerType,
        steps_executed: [],
        status: 'success',
      }
    })

    await executeStepsFrom({
      automation,
      contactId: input.contactId ?? null,
      context: input.context ?? {},
      parentStepId: null,
      branch: null,
      startPosition: 0,
      logId: log.id,
      triggerEvent: input.triggerType,
    })

    await prisma.waAutomation.update({
      where: { id: automation.id },
      data: { execution_count: { increment: 1 } }
    })
  } catch (logErr) {
    console.error('[automations] cannot create log:', logErr)
  }
}

interface ExecuteArgs {
  automation: Automation
  contactId: string | null
  context: AutomationContext
  parentStepId: string | null
  branch: 'yes' | 'no' | null
  startPosition: number
  logId: string | null
  triggerEvent: string
}

async function executeStepsFrom(args: ExecuteArgs): Promise<void> {
  try {
    const whereClause: any = {
      automation_id: args.automation.id,
      position: { gte: args.startPosition }
    }
    
    if (args.parentStepId === null) {
      whereClause.parent_step_id = null
    } else {
      whereClause.parent_step_id = args.parentStepId
      whereClause.branch = args.branch ?? 'yes'
    }

    const steps = await prisma.waAutomationStep.findMany({
      where: whereClause,
      orderBy: { position: 'asc' }
    })

    if (!steps || steps.length === 0) {
      if (args.parentStepId === null && args.logId) {
        await finalizeLog(args.logId, 'success', null)
      }
      return
    }

    const results: AutomationLogStepResult[] = []
    let status: 'success' | 'partial' | 'failed' = 'success'
    let errorMessage: string | null = null

    for (const step of steps as unknown as AutomationStep[]) {
      if (step.step_type === 'wait') {
        const cfg = step.step_config as WaitStepConfig
        const ms = waitMs(cfg)
        await prisma.waAutomationPendingExecution.create({
          data: {
            automation_id: args.automation.id,
            user_id: args.automation.user_id,
            contact_id: args.contactId,
            log_id: args.logId,
            parent_step_id: args.parentStepId,
            branch: args.branch,
            next_step_position: step.position + 1,
            context: args.context as any,
            run_at: new Date(Date.now() + ms),
            status: 'pending',
          }
        })
        results.push({
          step_id: step.id,
          step_type: step.step_type,
          status: 'success',
          detail: `waiting ${cfg.amount} ${cfg.unit}`,
        })
        status = 'partial'
        await appendResults(args.logId, results, status, errorMessage)
        return
      }

      try {
        if (step.step_type === 'condition') {
          const cfg = step.step_config as ConditionStepConfig
          const taken = await evaluateCondition(cfg, args)
          results.push({
            step_id: step.id,
            step_type: 'condition',
            status: 'success',
            detail: `branch=${taken ? 'yes' : 'no'}`,
          })
          await executeStepsFrom({
            ...args,
            parentStepId: step.id,
            branch: taken ? 'yes' : 'no',
            startPosition: 0,
            logId: args.logId,
          })
          continue
        }

        const detail = await runStep(step, args)
        results.push({
          step_id: step.id,
          step_type: step.step_type,
          status: 'success',
          detail,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        results.push({
          step_id: step.id,
          step_type: step.step_type,
          status: 'failed',
          detail: msg,
        })
        status = 'failed'
        errorMessage = msg
        break
      }
    }

    if (args.parentStepId === null) {
      await appendResults(args.logId, results, status, errorMessage)
    } else {
      await appendResults(args.logId, results, null, errorMessage)
    }
  } catch (stepsErr: any) {
    await finalizeLog(args.logId, 'failed', stepsErr.message)
  }
}

async function runStep(step: AutomationStep, args: ExecuteArgs): Promise<string> {
  switch (step.step_type) {
    case 'send_message': {
      const cfg = step.step_config as SendMessageStepConfig
      if (!args.contactId) throw new Error('send_message needs a contact')
      const text = interpolate(cfg.text, args)
      if (!text.trim()) throw new Error('send_message has empty text')
      const conversationId = await resolveConversationId(args)
      const { whatsapp_message_id } = await engineSendText({
        userId: args.automation.user_id,
        conversationId,
        contactId: args.contactId,
        text,
      })
      return `sent via Meta (${whatsapp_message_id})`
    }

    case 'send_template': {
      const cfg = step.step_config as SendTemplateStepConfig
      if (!args.contactId) throw new Error('send_template needs a contact')
      if (!cfg.template_name) throw new Error('send_template needs template_name')
      const conversationId = await resolveConversationId(args)
      const params = cfg.variables
        ? Object.keys(cfg.variables)
            .sort((a, b) => {
              const na = Number(a)
              const nb = Number(b)
              const aNum = Number.isFinite(na)
              const bNum = Number.isFinite(nb)
              if (aNum && bNum) return na - nb
              if (aNum) return -1
              if (bNum) return 1
              return a.localeCompare(b)
            })
            .map((k) => String(cfg.variables![k]))
        : []
      const { whatsapp_message_id } = await engineSendTemplate({
        userId: args.automation.user_id,
        conversationId,
        contactId: args.contactId,
        templateName: cfg.template_name,
        language: cfg.language,
        params,
      })
      return `template sent via Meta (${whatsapp_message_id})`
    }

    case 'add_tag': {
      const cfg = step.step_config as TagStepConfig
      if (!args.contactId || !cfg.tag_id) throw new Error('add_tag needs contact + tag_id')
      await prisma.waContactTag.upsert({
        where: {
          contact_id_tag_id: {
            contact_id: args.contactId,
            tag_id: cfg.tag_id
          }
        },
        update: {},
        create: {
          contact_id: args.contactId,
          tag_id: cfg.tag_id
        }
      })
      return `tag ${cfg.tag_id} added`
    }

    case 'remove_tag': {
      const cfg = step.step_config as TagStepConfig
      if (!args.contactId || !cfg.tag_id) throw new Error('remove_tag needs contact + tag_id')
      await prisma.waContactTag.deleteMany({
        where: { contact_id: args.contactId, tag_id: cfg.tag_id }
      })
      return `tag ${cfg.tag_id} removed`
    }

    case 'assign_conversation': {
      const cfg = step.step_config as AssignConversationStepConfig
      if (!args.contactId) throw new Error('assign_conversation needs a contact')
      let agentId = cfg.agent_id
      if (cfg.mode === 'round_robin') {
        const profile = await prisma.waProfile.findFirst({
          where: { user_id: args.automation.user_id }
        })
        agentId = profile?.user_id
      }
      if (!agentId) return 'no agent resolved'
      await prisma.waConversation.updateMany({
        where: { user_id: args.automation.user_id, contact_id: args.contactId },
        data: { assigned_agent_id: agentId }
      })
      return `assigned to ${agentId}`
    }

    case 'update_contact_field': {
      const cfg = step.step_config as UpdateContactFieldStepConfig
      if (!args.contactId) throw new Error('update_contact_field needs a contact')
      const allowed = new Set(['name', 'email', 'company'])
      if (!allowed.has(cfg.field)) {
        return `field ${cfg.field} not writable from automations`
      }
      await prisma.waContact.update({
        where: { id: args.contactId },
        data: { [cfg.field]: cfg.value }
      })
      return `${cfg.field} updated`
    }

    case 'create_deal': {
      const cfg = step.step_config as CreateDealStepConfig
      if (!cfg.pipeline_id || !cfg.stage_id) throw new Error('create_deal needs pipeline + stage')
      await prisma.waDeal.create({
        data: {
          user_id: args.automation.user_id,
          pipeline_id: cfg.pipeline_id,
          stage_id: cfg.stage_id,
          contact_id: args.contactId,
          title: interpolate(cfg.title, args),
          value: cfg.value ?? 0,
          status: 'open',
        }
      })
      return 'deal created'
    }

    case 'send_webhook': {
      const cfg = step.step_config as SendWebhookStepConfig
      if (!cfg.url) throw new Error('send_webhook needs url')
      const body = cfg.body_template ? interpolate(cfg.body_template, args) : JSON.stringify(args.context)
      const res = await fetch(cfg.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cfg.headers ?? {}) },
        body,
      })
      if (!res.ok) throw new Error(`webhook returned ${res.status}`)
      return `webhook ${res.status}`
    }

    case 'close_conversation': {
      if (!args.contactId) throw new Error('close_conversation needs a contact')
      await prisma.waConversation.updateMany({
        where: { user_id: args.automation.user_id, contact_id: args.contactId },
        data: { status: 'closed' }
      })
      return 'conversation closed'
    }

    default:
      return `unknown step: ${step.step_type}`
  }
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

async function resolveConversationId(args: ExecuteArgs): Promise<string> {
  const fromCtx = args.context.conversation_id
  if (fromCtx) return fromCtx
  if (!args.contactId) throw new Error('cannot resolve conversation: no contact')
  const conv = await prisma.waConversation.findFirst({
    where: { user_id: args.automation.user_id, contact_id: args.contactId },
    select: { id: true }
  })
  if (!conv) throw new Error('no conversation for contact')
  return conv.id
}

function triggerMatches(automation: Automation, ctx: AutomationContext | undefined): boolean {
  if (automation.trigger_type !== 'keyword_match') return true
  const cfg = automation.trigger_config as KeywordMatchTriggerConfig
  if (!cfg?.keywords || cfg.keywords.length === 0) return false
  const text = (ctx?.message_text ?? '').toString()
  if (!text) return false
  const haystack = cfg.case_sensitive ? text : text.toLowerCase()
  return cfg.keywords.some((raw) => {
    const k = cfg.case_sensitive ? raw : raw.toLowerCase()
    return cfg.match_type === 'exact' ? haystack === k : haystack.includes(k)
  })
}

async function evaluateCondition(cfg: ConditionStepConfig, args: ExecuteArgs): Promise<boolean> {
  switch (cfg.subject) {
    case 'tag_presence': {
      if (!args.contactId || !cfg.operand) return false
      const count = await prisma.waContactTag.count({
        where: { contact_id: args.contactId, tag_id: cfg.operand }
      })
      return count > 0
    }
    case 'contact_field': {
      if (!args.contactId || !cfg.operand) return false
      const contact: any = await prisma.waContact.findUnique({
        where: { id: args.contactId },
        select: { [cfg.operand]: true }
      })
      const v = contact?.[cfg.operand]
      return v != null && String(v) === String(cfg.value ?? '')
    }
    case 'message_content': {
      const text = (args.context.message_text ?? '').toString()
      return text.toLowerCase().includes((cfg.value ?? '').toLowerCase())
    }
    case 'time_of_day': {
      const [from, to] = (cfg.operand ?? '').split('-')
      if (!from || !to) return false
      const now = new Date()
      const mins = now.getHours() * 60 + now.getMinutes()
      const parse = (s: string) => {
        const [h, m] = s.split(':').map(Number)
        return (h || 0) * 60 + (m || 0)
      }
      const f = parse(from)
      const t = parse(to)
      return f <= t ? mins >= f && mins < t : mins >= f || mins < t
    }
    default:
      return false
  }
}

function waitMs(cfg: WaitStepConfig): number {
  const unitMs = cfg.unit === 'days' ? 86_400_000 : cfg.unit === 'hours' ? 3_600_000 : 60_000
  return Math.max(1_000, cfg.amount * unitMs)
}

function interpolate(s: string, args: ExecuteArgs): string {
  return s.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const [ns, prop] = String(key).split('.')
    if (ns === 'message' && prop === 'text') return String(args.context.message_text ?? '')
    if (ns === 'vars' && prop) return String(args.context.vars?.[prop] ?? '')
    return ''
  })
}

async function appendResults(
  logId: string | null,
  newItems: AutomationLogStepResult[],
  status: 'success' | 'partial' | 'failed' | null,
  errorMessage: string | null,
) {
  if (!logId) return
  const existing = await prisma.waAutomationLog.findUnique({
    where: { id: logId },
    select: { steps_executed: true, status: true }
  })
  
  const merged = [
    ...((existing?.steps_executed as unknown as AutomationLogStepResult[]) ?? []),
    ...newItems,
  ]
  const update: Record<string, unknown> = { steps_executed: merged as any }
  
  if (status !== null) {
    update.status = status
  }
  if (errorMessage) update.error_message = errorMessage
  
  await prisma.waAutomationLog.update({
    where: { id: logId },
    data: update as any
  })
}

async function finalizeLog(
  logId: string | null,
  status: 'success' | 'partial' | 'failed',
  errorMessage: string | null,
) {
  if (!logId) return
  await prisma.waAutomationLog.update({
    where: { id: logId },
    data: { status, error_message: errorMessage }
  })
}

async function markPending(id: string, status: 'done' | 'failed') {
  await prisma.waAutomationPendingExecution.update({
    where: { id },
    data: { status }
  })
}
