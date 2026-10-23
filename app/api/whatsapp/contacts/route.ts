import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth-helpers'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'

function serializeContact(contact: {
  id: string
  user_id: string
  phone: string
  name: string | null
  email: string | null
  company: string | null
  avatar_url: string | null
  created_at: Date
  updated_at: Date
  contact_tags?: Array<{ tag: { id: string; name: string; color: string } }>
}) {
  return {
    id: contact.id,
    user_id: contact.user_id,
    phone: contact.phone,
    name: contact.name,
    email: contact.email,
    company: contact.company,
    avatar_url: contact.avatar_url,
    created_at: contact.created_at.toISOString(),
    updated_at: contact.updated_at.toISOString(),
    tags: contact.contact_tags?.map((ct) => ct.tag) ?? [],
  }
}

export async function GET(request: Request) {
  try {
    const session = await getSession()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const search = (searchParams.get('search') ?? '').trim()
    const all = ['1', 'true', 'yes'].includes(String(searchParams.get('all') ?? '').toLowerCase())
    const fields = (searchParams.get('fields') ?? '').trim().toLowerCase()
    const countOnly = ['1', 'true', 'yes'].includes(String(searchParams.get('count_only') ?? '').toLowerCase())

    // Support both `pageSize` and `page_size` spellings
    const page = Math.max(0, Number.parseInt(searchParams.get('page') ?? '0', 10) || 0)
    const pageSizeRaw =
      Number.parseInt(searchParams.get('pageSize') ?? searchParams.get('page_size') ?? '25', 10) || 25
    const pageSize = Math.min(Math.max(pageSizeRaw, 1), 250)

    const userId = String(session.user.id)

    // ── Build where clause ────────────────────────────────────────────────
    const where: Record<string, unknown> = { user_id: userId }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ]
    }

    // Tag-include filter (used by step2/step4 broadcast audience)
    const tagIds = searchParams.get('tag_ids')?.split(',').filter(Boolean) ?? []
    if (tagIds.length > 0) {
      where.contact_tags = { some: { tag_id: { in: tagIds } } }
    }

    // Tag-exclude filter
    const excludeTagIds = searchParams.get('exclude_tag_ids')?.split(',').filter(Boolean) ?? []
    if (excludeTagIds.length > 0) {
      where.contact_tags = {
        ...(where.contact_tags as object ?? {}),
        none: { tag_id: { in: excludeTagIds } },
      }
    }

    // Custom field filter
    const cfId = searchParams.get('custom_field_id')
    const cfOp = searchParams.get('custom_field_op') ?? 'is'
    const cfVal = searchParams.get('custom_field_value')
    if (cfId && cfVal) {
      let valueFilter: Record<string, unknown>
      if (cfOp === 'is') valueFilter = { equals: cfVal }
      else if (cfOp === 'is_not') valueFilter = { not: cfVal }
      else valueFilter = { contains: cfVal, mode: 'insensitive' }

      where.contact_custom_values = {
        some: { custom_field_id: cfId, value: valueFilter },
      }
    }

    // ── count_only: just return the count ─────────────────────────────────
    if (countOnly) {
      const total = await prisma.waContact.count({ where })
      return NextResponse.json({ total, count: total })
    }

    const listArgs: Record<string, unknown> = {
      where,
      orderBy: { created_at: 'desc' },
    }

    if (!all) {
      listArgs.skip = page * pageSize
      listArgs.take = pageSize
    }

    if (fields === 'basic') {
      listArgs.select = { id: true, user_id: true, name: true, phone: true, created_at: true, updated_at: true }
    } else {
      listArgs.include = { contact_tags: { include: { tag: true } } }
    }

    const [total, contacts] = await Promise.all([
      prisma.waContact.count({ where }),
      prisma.waContact.findMany(listArgs as any),
    ])

    if (fields === 'basic') {
      return NextResponse.json({ data: contacts, total, count: total })
    }

    return NextResponse.json({
      data: (contacts as Array<Parameters<typeof serializeContact>[0]>).map(serializeContact),
      total,
      count: total,
    })
  } catch (error) {
    console.error('Error loading WA contacts:', error)
    return NextResponse.json({ error: 'Failed to load contacts' }, { status: 500 })
  }
}


function normalizeForMatch(value: string): string {
  return normalizePhone(value ?? '')
}

function lastTenDigits(value: string): string {
  if (!value) return ''
  return value.length > 10 ? value.slice(-10) : value
}

export async function POST() {
  try {
    const session = await getSession()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = String(session.user.id)

    const crmContacts = await prisma.contact.findMany({
      select: { name: true, phone: true, email: true },
    })

    if (crmContacts.length === 0) {
      return NextResponse.json({ success: true, created: 0, updated: 0, total: 0 })
    }

    const waContacts = await prisma.waContact.findMany({
      where: { user_id: userId },
      select: { id: true, phone: true, name: true, email: true },
    })

    const waByNormalized = new Map<string, typeof waContacts[number]>()
    const waByLast10 = new Map<string, typeof waContacts[number][]>()

    for (const wa of waContacts) {
      const normalized = normalizeForMatch(wa.phone)
      if (normalized) {
        waByNormalized.set(normalized, wa)
        const last10 = lastTenDigits(normalized)
        if (last10) {
          const bucket = waByLast10.get(last10) ?? []
          bucket.push(wa)
          waByLast10.set(last10, bucket)
        }
      }
    }

    const toCreate: { user_id: string; phone: string; name?: string | null; email?: string | null }[] = []
    const toUpdate: { id: string; data: { name?: string; email?: string } }[] = []

    function findMatch(phone: string) {
      const normalized = normalizeForMatch(phone)
      if (!normalized) return null
      const direct = waByNormalized.get(normalized)
      if (direct) return direct
      const last10 = lastTenDigits(normalized)
      if (!last10) return null
      const candidates = waByLast10.get(last10) ?? []
      if (candidates.length === 1) return candidates[0]
      return null
    }

    for (const crm of crmContacts) {
      const phone = String(crm.phone ?? '').trim()
      if (!phone) continue

      const match = findMatch(phone)
      if (!match) {
        toCreate.push({
          user_id: userId,
          phone,
          name: crm.name?.trim() || null,
          email: crm.email?.trim() || null,
        })
        continue
      }

      const update: { name?: string; email?: string } = {}
      if ((!match.name || !match.name.trim()) && crm.name?.trim()) {
        update.name = crm.name.trim()
      }
      if ((!match.email || !match.email.trim()) && crm.email?.trim()) {
        update.email = crm.email.trim()
      }

      if (Object.keys(update).length > 0) {
        toUpdate.push({ id: match.id, data: update })
      }
    }

    if (toCreate.length > 0) {
      await prisma.waContact.createMany({ data: toCreate })
    }

    if (toUpdate.length > 0) {
      await Promise.all(
        toUpdate.map((row) =>
          prisma.waContact.update({ where: { id: row.id }, data: row.data }),
        ),
      )
    }

    return NextResponse.json({
      success: true,
      created: toCreate.length,
      updated: toUpdate.length,
      total: crmContacts.length,
    })
  } catch (error) {
    console.error('Error syncing WA contacts:', error)
    return NextResponse.json({ error: 'Failed to sync contacts' }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    const session = await getSession()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = String(session.user.id)

    const result = await prisma.waContact.deleteMany({
      where: {
        user_id: userId,
        name: { equals: 'WA Smoke Contact', mode: 'insensitive' },
      },
    })

    return NextResponse.json({ success: true, removed: result.count })
  } catch (error) {
    console.error('Error cleaning WA smoke contacts:', error)
    return NextResponse.json({ error: 'Failed to remove smoke contacts' }, { status: 500 })
  }
}
