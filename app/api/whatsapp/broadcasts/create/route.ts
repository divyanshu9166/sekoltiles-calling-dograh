import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

export async function POST(request: Request) {
  try {
    const session = await getSession()
    if (!session?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = String(session.id)

    const payload = await request.json()
    const { name, template, audience, variables } = payload

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

    if (contacts.length === 0) {
      return NextResponse.json({ error: 'No contacts found for this audience.' }, { status: 400 })
    }

    const broadcast = await prisma.waBroadcast.create({
      data: {
        user_id: userId,
        name,
        template_name: template.name,
        template_language: template.language ?? 'en_US',
        template_variables: variables ?? {},
        audience_filter: audience,
        status: 'sending',
        total_recipients: contacts.length,
        sent_count: 0,
        delivered_count: 0,
        read_count: 0,
        replied_count: 0,
        failed_count: 0,
      }
    })

    const recipientRows = contacts.map(contact => ({
      broadcast_id: broadcast.id,
      contact_id: contact.id,
      status: 'pending',
    }))

    await prisma.waBroadcastRecipient.createMany({
      data: recipientRows as any
    })

    // Fetch custom values for all contacts in this broadcast
    const contactIds = contacts.map(c => c.id)
    const customValues = await prisma.waContactCustomValue.findMany({
      where: { contact_id: { in: contactIds } },
      select: { contact_id: true, custom_field_id: true, value: true }
    })
    
    // Group custom values by contact
    const customValueIndex = customValues.reduce((acc, curr) => {
      if (!acc[curr.contact_id]) acc[curr.contact_id] = {}
      acc[curr.contact_id][curr.custom_field_id] = curr.value || ''
      return acc
    }, {} as Record<string, Record<string, string>>)

    const recipientsWithData = contacts.map(c => ({
      id: recipientRows.find(r => r.contact_id === c.id)?.contact_id, // we don't have the exact recipient ID from createMany, but we can return contact ID and phone
      contact_id: c.id,
      phone: c.phone,
      name: c.name,
      email: c.email,
      company: c.company,
      custom_values: customValueIndex[c.id] || {}
    }))

    return NextResponse.json({
      broadcastId: broadcast.id,
      recipients: recipientsWithData
    })
  } catch (error) {
    console.error('Error creating broadcast:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 })
  }
}
