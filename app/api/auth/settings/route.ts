import { NextRequest, NextResponse } from 'next/server'
import {
  getCurrentAdmin,
  updateAdminCredentials,
  validateUsername,
  verifyPassword,
} from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET() {
  const user = await getCurrentAdmin()
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 })
  return NextResponse.json({ success: true, user: { username: user.username } })
}

export async function PATCH(request: NextRequest) {
  const user = await getCurrentAdmin()
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 })

  try {
    const body = await request.json()
    const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : ''
    const requestedUsername = typeof body?.username === 'string' ? body.username.trim() : user.username
    const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : ''

    if (!currentPassword || !await verifyPassword(currentPassword, user.passwordHash)) {
      return NextResponse.json({ success: false, error: 'Current password is incorrect.' }, { status: 400 })
    }
    if (!validateUsername(requestedUsername)) {
      return NextResponse.json({ success: false, error: 'Username must be 3–64 letters, numbers, dots, underscores or hyphens.' }, { status: 400 })
    }
    if (newPassword && newPassword.length < 8) {
      return NextResponse.json({ success: false, error: 'New password must be at least 8 characters.' }, { status: 400 })
    }
    if (requestedUsername === user.username && !newPassword) {
      return NextResponse.json({ success: false, error: 'Enter a new username or password.' }, { status: 400 })
    }

    // Check the username before invalidating the current session so a typo or
    // duplicate does not log the administrator out.
    if (requestedUsername !== user.username) {
      const duplicate = await prisma.adminUser.findUnique({ where: { username: requestedUsername } })
      if (duplicate && duplicate.id !== user.id) {
        return NextResponse.json({ success: false, error: 'That username is already in use.' }, { status: 409 })
      }
    }

    await updateAdminCredentials({
      userId: user.id,
      username: requestedUsername,
      newPassword: newPassword || undefined,
    })
    return NextResponse.json({ success: true, user: { username: requestedUsername } })
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ success: false, error: 'That username is already in use.' }, { status: 409 })
    }
    console.error('Credential update failed:', error)
    return NextResponse.json({ success: false, error: 'Could not update credentials.' }, { status: 500 })
  }
}
