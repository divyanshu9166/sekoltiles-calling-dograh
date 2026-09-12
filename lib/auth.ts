import 'server-only'

import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/db'

export const SESSION_COOKIE = 'sekol_session'
export const DEFAULT_ADMIN_USERNAME = 'sekoltiles'
export const DEFAULT_ADMIN_PASSWORD = 'sikoltiles123'

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30
const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_SECONDS * 1000
const scryptAsync = promisify(scrypt)

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex')
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer
  return `scrypt$${salt}$${derivedKey.toString('hex')}`
}

export async function verifyPassword(password: string, encodedHash: string) {
  const [algorithm, salt, expectedHex] = encodedHash.split('$')
  if (algorithm !== 'scrypt' || !salt || !expectedHex) return false

  try {
    const expected = Buffer.from(expectedHex, 'hex')
    const actual = (await scryptAsync(password, salt, expected.length)) as Buffer
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

function hashSessionToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function setSessionCookie(token: string) {
  return cookies().then((cookieStore) => {
    cookieStore.set({
      name: SESSION_COOKIE,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
    })
  })
}

/**
 * Creates the first admin account on a fresh database. Existing credentials
 * are never overwritten, so a password changed in Settings survives deploys.
 */
export async function ensureAdminUser() {
  const existing = await prisma.adminUser.findFirst({ orderBy: { id: 'asc' } })
  if (existing) return existing

  try {
    return await prisma.adminUser.create({
      data: {
        username: DEFAULT_ADMIN_USERNAME,
        passwordHash: await hashPassword(DEFAULT_ADMIN_PASSWORD),
      },
    })
  } catch (error: unknown) {
    // Two first requests can race during the initial login. Re-read the row
    // if another request won the unique insert race.
    if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002') {
      const created = await prisma.adminUser.findFirst({ orderBy: { id: 'asc' } })
      if (created) return created
    }
    throw error
  }
}

export async function getCurrentAdmin() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (!token) return null

  const session = await prisma.adminSession.findFirst({
    where: { tokenHash: hashSessionToken(token), expiresAt: { gt: new Date() } },
    include: { user: true },
  })
  return session?.user ?? null
}

export async function createSession(userId: number) {
  const token = randomBytes(32).toString('hex')
  const now = Date.now()

  await prisma.adminSession.deleteMany({ where: { expiresAt: { lte: new Date(now) } } })
  await prisma.adminSession.create({
    data: {
      tokenHash: hashSessionToken(token),
      userId,
      expiresAt: new Date(now + SESSION_MAX_AGE_MS),
    },
  })
  await setSessionCookie(token)
}

export async function destroySession() {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (token) {
    await prisma.adminSession.deleteMany({ where: { tokenHash: hashSessionToken(token) } })
  }
  cookieStore.delete(SESSION_COOKIE)
}

export function validateUsername(username: string) {
  return /^[a-zA-Z0-9._-]{3,64}$/.test(username)
}

export async function updateAdminCredentials({
  userId,
  username,
  newPassword,
}: {
  userId: number
  username: string
  newPassword?: string
}) {
  const passwordHash = newPassword ? await hashPassword(newPassword) : undefined
  await prisma.$transaction([
    prisma.adminUser.update({ where: { id: userId }, data: { username, ...(passwordHash ? { passwordHash } : {}) } }),
    // Changing credentials invalidates every old browser session.
    prisma.adminSession.deleteMany({ where: { userId } }),
  ])
  await createSession(userId)
}
