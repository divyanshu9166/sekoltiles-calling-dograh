import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import {
  blankVariables,
  describeMapping,
  parseVariableMappings,
  resolveVariables,
  variableKeys,
} from '@/lib/whatsapp/broadcast-variables'

// Postgres allows ~32k bind parameters per query; big audiences go in chunks.
const ID_CHUNK = 10_000

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += ID_CHUNK) out.push(items.slice(i, i + ID_CHUNK))
  return out
}

export async function POST(request: Request) {
  try {
    const session = await getSession()
    if (!session?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = String(session.id)
    
    const { audience, variables: rawVariables } = await request.json()
    if (!audience) return NextResponse.json({ error: 'Missing audience' }, { status: 400 })

    let baseIds: Set<string> | null = null

    if (audience.type === 'all') {
      const all = await prisma.waContact.findMany({
        where: { user_id: userId },
        select: { id: true }
      })
      baseIds = new Set(all.map(c => c.id))
    } else if (audience.type === 'tags' && audience.tagIds?.length > 0) {
      const tagRows = await prisma.waContactTag.findMany({
        where: { tag_id: { in: audience.tagIds } },
        select: { contact_id: true }
      })
      const cIds = tagRows.map(r => r.contact_id)
      const validContacts = await prisma.waContact.findMany({
        where: { id: { in: cIds }, user_id: userId },
        select: { id: true }
      })
      baseIds = new Set(validContacts.map(c => c.id))
    } else if (audience.type === 'custom_field' && audience.customField?.fieldId && audience.customField.value) {
      const { fieldId, operator, value } = audience.customField
      let customFieldWhere: any = { custom_field_id: fieldId }
      
      if (operator === 'is') customFieldWhere.value = value
      else if (operator === 'is_not') customFieldWhere.value = { not: value }
      else if (operator === 'contains') customFieldWhere.value = { contains: value, mode: 'insensitive' }

      const customValues = await prisma.waContactCustomValue.findMany({
        where: customFieldWhere,
        select: { contact_id: true }
      })
      const cIds = customValues.map(r => r.contact_id)
      const validContacts = await prisma.waContact.findMany({
        where: { id: { in: cIds }, user_id: userId },
        select: { id: true }
      })
      baseIds = new Set(validContacts.map(c => c.id))
    } else if (audience.type === 'manual' && audience.selectedContactIds?.length > 0) {
      const validContacts = await prisma.waContact.findMany({
        where: { id: { in: audience.selectedContactIds }, user_id: userId },
        select: { id: true }
      })
      baseIds = new Set(validContacts.map(c => c.id))
    } else if (audience.type === 'csv' && audience.csvContacts?.length > 0) {
      return NextResponse.json({ count: audience.csvContacts.length })
    } else {
      return NextResponse.json({ count: null })
    }

    let excludeSet = new Set<string>()
    if (audience.excludeTagIds?.length > 0) {
      const excludeRows = await prisma.waContactTag.findMany({
        where: { tag_id: { in: audience.excludeTagIds } },
        select: { contact_id: true }
      })
      excludeSet = new Set(excludeRows.map(r => r.contact_id))
    }

    const candidates = [...baseIds].filter(id => !excludeSet.has(id))

    // Customers who replied STOP or turned off marketing in WhatsApp are skipped.
    const optedOutIds = new Set<string>()
    for (const ids of chunks(candidates)) {
      const rows = await prisma.waContact.findMany({
        where: { id: { in: ids }, user_id: userId, opted_out_at: { not: null } },
        select: { id: true },
      })
      for (const row of rows) optedOutIds.add(row.id)
    }
    const effective = candidates.filter(id => !optedOutIds.has(id))

    // Template variables that would be empty for some contacts: WhatsApp
    // rejects those messages (#131008), so the sender skips them. Report how
    // many before sending.
    const variables = parseVariableMappings(rawVariables)
    const keys = variableKeys(variables)
    const missing: Record<string, number> = {}
    let blankContacts = 0
    if (keys.some(k => variables[k].type !== 'static') || keys.some(k => !variables[k].value.trim())) {
      const customFieldIds = [...new Set(keys.filter(k => variables[k].type === 'custom_field').map(k => variables[k].value))]
      for (const ids of chunks(effective)) {
        const contacts = await prisma.waContact.findMany({
          where: { id: { in: ids }, user_id: userId },
          select: { id: true, name: true, phone: true, email: true, company: true },
        })
        const custom = customFieldIds.length
          ? await prisma.waContactCustomValue.findMany({
              where: { contact_id: { in: ids }, custom_field_id: { in: customFieldIds } },
              select: { contact_id: true, custom_field_id: true, value: true },
            })
          : []
        const customByContact = new Map<string, Record<string, string>>()
        for (const row of custom) {
          const values = customByContact.get(row.contact_id) ?? {}
          values[row.custom_field_id] = row.value ?? ''
          customByContact.set(row.contact_id, values)
        }
        for (const contact of contacts) {
          const blank = blankVariables(variables, resolveVariables(variables, contact, customByContact.get(contact.id)))
          if (!blank.length) continue
          blankContacts++
          for (const key of blank) missing[key] = (missing[key] ?? 0) + 1
        }
      }
    }
    const customFieldNames = new Map(
      (await prisma.waCustomField.findMany({ where: { user_id: userId }, select: { id: true, field_name: true } }))
        .map(f => [f.id, f.field_name]),
    )
    const blankVariableList = Object.entries(missing).map(([key, count]) => ({
      key,
      count,
      source: describeMapping(
        variables[key],
        variables[key].type === 'custom_field' ? customFieldNames.get(variables[key].value) : undefined,
      ),
    }))

    return NextResponse.json({
      count: effective.length,
      opted_out: optedOutIds.size,
      blank_contacts: blankContacts,
      blank_variables: blankVariableList,
    })
  } catch (error) {
    console.error('Error in audience preview:', error)
    return NextResponse.json({ error: 'Failed to preview audience' }, { status: 500 })
  }
}
