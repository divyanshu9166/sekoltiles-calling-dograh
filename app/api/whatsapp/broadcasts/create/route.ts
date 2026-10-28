import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { parseHeaderMedia } from '@/lib/whatsapp/template-header'
import { enqueueBroadcastSend } from '@/lib/whatsapp/broadcast-queue'
import { parseScheduledAt } from '@/lib/whatsapp/broadcast-schedule'
import { parseSendExtras, sendExtrasComponentParams } from '@/lib/whatsapp/template-send-extras'

export async function POST(request: Request) {
  try {
    const session = await getSession()
    if (!session?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = String(session.id)

    const limit = checkRateLimit(`broadcast:${userId}`, RATE_LIMITS.broadcast)
    if (!limit.success) return rateLimitResponse(limit)

    const payload = await request.json()
    const { name, template, audience, variables } = payload

    if (!template?.name || !audience?.type) {
      return NextResponse.json({ error: 'Template and audience are required' }, { status: 400 })
    }

    // Photo/video/PDF for a template with a media header, uploaded once
    // through /api/whatsapp/media/upload and reused for every recipient.
    const headerMedia = parseHeaderMedia(payload.header_media)
    if (payload.header_media && !headerMedia) {
      return NextResponse.json({ error: 'header_media is invalid' }, { status: 400 })
    }

    // Header {{1}}, location pin, link endings and offer code: checked against
    // the stored template now, so every recipient gets valid parameters.
    const templateRow = await prisma.waMessageTemplate.findFirst({
      where: { user_id: userId, name: template.name, language: template.language ?? 'en_US' },
      select: { header_type: true, header_content: true, buttons: true },
    })
    let templateExtras: ReturnType<typeof sendExtrasComponentParams> = {}
    if (templateRow) {
      const parsed = parseSendExtras(templateRow, payload.template_extras)
      if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
      templateExtras = sendExtrasComponentParams(templateRow, parsed.extras)
    }

    const schedule = parseScheduledAt(payload.scheduled_at, Date.now(), { hasHeaderMedia: !!headerMedia })
    if ('error' in schedule) {
      return NextResponse.json({ error: schedule.error }, { status: 400 })
    }
    const scheduledAt = schedule.scheduledAt

    let contacts: any[] = []

    if (audience.type === 'all') {
      contacts = await prisma.waContact.findMany({ where: { user_id: userId } })
    } else if (audience.type === 'tags' && audience.tagIds && audience.tagIds.length > 0) {
      const contactTags = await prisma.waContactTag.findMany({
        where: { tag_id: { in: audience.tagIds } }
      })
      const contactIds = [...new Set(contactTags.map(ct => ct.contact_id))]
      contacts = await prisma.waContact.findMany({
        where: { id: { in: contactIds }, user_id: userId }
      })
    } else if (audience.type === 'custom_field' && audience.customField) {
      const { fieldId, operator, value } = audience.customField
      let customFieldWhere: any = { custom_field_id: fieldId }
      
      if (operator === 'is') customFieldWhere.value = value
      else if (operator === 'is_not') customFieldWhere.value = { not: value }
      else if (operator === 'contains') customFieldWhere.value = { contains: value, mode: 'insensitive' }

      const customValues = await prisma.waContactCustomValue.findMany({
        where: customFieldWhere
      })
      const contactIds = [...new Set(customValues.map(cv => cv.contact_id))]
      contacts = await prisma.waContact.findMany({
        where: { id: { in: contactIds }, user_id: userId }
      })
    } else if (audience.type === 'csv' && audience.csvContacts) {
      const uniqueByPhone = new Map<string, any>()
      for (const row of audience.csvContacts) {
        if (row.phone) uniqueByPhone.set(row.phone, row)
      }
      const phones = [...uniqueByPhone.keys()]
      
      const existing = await prisma.waContact.findMany({
        where: { user_id: userId, phone: { in: phones } }
      })
      const byPhone = new Map<string, any>()
      for (const c of existing) {
        if (c.phone) byPhone.set(c.phone, c)
      }
      
      const missing = phones
        .filter(p => !byPhone.has(p))
        .map(phone => ({
          user_id: userId,
          phone,
          name: uniqueByPhone.get(phone)?.name ?? null,
        }))
        
      if (missing.length > 0) {
        await prisma.waContact.createMany({ data: missing })
        const newlyInserted = await prisma.waContact.findMany({
          where: { user_id: userId, phone: { in: missing.map(m => m.phone) } }
        })
        for (const c of newlyInserted) {
          if (c.phone) byPhone.set(c.phone, c)
        }
      }
      
      contacts = phones.map(p => byPhone.get(p)).filter(Boolean)
    } else if (audience.type === 'manual' && audience.selectedContactIds) {
      contacts = await prisma.waContact.findMany({
        where: { id: { in: audience.selectedContactIds }, user_id: userId }
      })
    }

    if (audience.excludeTagIds && audience.excludeTagIds.length > 0) {
      const excludeRows = await prisma.waContactTag.findMany({
        where: { tag_id: { in: audience.excludeTagIds } }
      })
      const excludedIds = new Set(excludeRows.map(r => r.contact_id))
      contacts = contacts.filter(c => !excludedIds.has(c.id))
    }

    contacts = [...new Map(contacts.map((contact) => [contact.id, contact])).values()]

    // Never send marketing to customers who opted out (STOP reply or
    // WhatsApp's own "stop promotions" button).
    const optedOutCount = contacts.filter((c) => c.opted_out_at).length
    contacts = contacts.filter((c) => !c.opted_out_at)

    if (contacts.length === 0) {
      return NextResponse.json(
        {
          error: optedOutCount
            ? 'Everyone in this audience has opted out of marketing messages.'
            : 'No contacts found for this audience.',
        },
        { status: 400 },
      )
    }

    const broadcast = await prisma.waBroadcast.create({
      data: {
        user_id: userId,
        name,
        template_name: template.name,
        template_language: template.language ?? 'en_US',
        template_variables: variables ?? {},
        audience_filter: audience,
        ...(headerMedia ? { header_media: { ...headerMedia } } : {}),
        ...(Object.keys(templateExtras).length ? { template_extras: JSON.parse(JSON.stringify(templateExtras)) } : {}),
        scheduled_at: scheduledAt,
        status: scheduledAt ? 'scheduled' : 'sending',
        total_recipients: contacts.length,
        sent_count: 0,
        delivered_count: 0,
        read_count: 0,
        replied_count: 0,
        failed_count: 0,
      }
    })

    await prisma.waBroadcastRecipient.createMany({
      data: contacts.map(contact => ({
        broadcast_id: broadcast.id,
        contact_id: contact.id,
        status: 'pending',
      })),
    })

    // The worker (lib/queues/broadcast-send-worker.ts) does the sending, so
    // it carries on after the browser tab closes.
    try {
      await enqueueBroadcastSend(broadcast.id, scheduledAt)
    } catch (queueError) {
      console.error('Could not queue broadcast:', queueError)
      await prisma.waBroadcast.delete({ where: { id: broadcast.id } }).catch(() => {})
      return NextResponse.json(
        { error: 'Could not start the broadcast: the sending queue (Redis) is unavailable. Nothing was sent.' },
        { status: 503 },
      )
    }

    return NextResponse.json({
      broadcastId: broadcast.id,
      status: broadcast.status,
      total: contacts.length,
      skippedOptedOut: optedOutCount,
    })
  } catch (error) {
    console.error('Error creating broadcast:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 })
  }
}
