import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

export async function POST(request: Request) {
  try {
    const session = await getSession()
    if (!session?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = String(session.id)
    
    const { audience } = await request.json()
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

    const effective = [...baseIds].filter(id => !excludeSet.has(id))
    
    return NextResponse.json({ count: effective.length })
  } catch (error) {
    console.error('Error in audience preview:', error)
    return NextResponse.json({ error: 'Failed to preview audience' }, { status: 500 })
  }
}
