import { NextRequest, NextResponse } from 'next/server'
import { createSession, ensureAdminUser, verifyPassword } from '@/lib/auth'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const username = typeof body?.username === 'string' ? body.username.trim() : ''
    const password = typeof body?.password === 'string' ? body.password : ''

    if (!username || !password) {
      return NextResponse.json({ success: false, error: 'Username and password are required.' }, { status: 400 })
    }

    const user = await ensureAdminUser()
    const valid = user.username === username && await verifyPassword(password, user.passwordHash)
    if (!valid) {
      return NextResponse.json({ success: false, error: 'Invalid username or password.' }, { status: 401 })
    }

    await createSession(user.id)
    return NextResponse.json({ success: true, user: { username: user.username } })
  } catch (error) {
    console.error('Login failed:', error)
    return NextResponse.json({ success: false, error: 'Login is temporarily unavailable.' }, { status: 500 })
  }
}
