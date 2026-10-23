import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'

export async function GET() {
  try {
    const session = await getSession()
    if (!session?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = String(session.id)
    
    const contact = await prisma.waContact.findFirst({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' }
    })
    
    if (!contact) {
      return NextResponse.json({ contact: null, customValues: [] })
    }

    const customVals = await prisma.waContactCustomValue.findMany({
      where: { contact_id: contact.id },
      select: { custom_field_id: true, value: true }
    })

    return NextResponse.json({ contact, customValues: customVals })
  } catch (error) {
    console.error('Error fetching preview contact:', error)
    return NextResponse.json({ error: 'Failed to fetch preview contact' }, { status: 500 })
  }
}
