import { NextResponse } from 'next/server'
import { getCurrentAdmin } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET() {
  try {
    const admin = await getCurrentAdmin()

    if (!admin) {
      return NextResponse.json(null)
    }

    const userId = String(admin.id)

    // Sync profile to WhatsApp CRM profiles table (non-critical, never crash auth)
    try {
      await prisma.waProfile.upsert({
        where: { user_id: userId },
        update: {
          full_name: admin.username,
          role: 'ADMIN',
        },
        create: {
          user_id: userId,
          full_name: admin.username,
          email: '',
          role: 'ADMIN',
        },
      })
    } catch {
      // waProfile sync is optional — don't let it break authentication
    }

    return NextResponse.json({
      user: {
        id: userId,
        email: null,
        name: admin.username,
        role: 'ADMIN',
        staffId: null,
        created_at: admin.createdAt.toISOString(),
      },
    })
  } catch (error) {
    console.error('GET /api/auth/me error:', error)
    return NextResponse.json(null, { status: 500 })
  }
}
