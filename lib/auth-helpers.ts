import 'server-only'

import { getSession as getCustomSession } from './session'

// Same shape as the Furniture CRM's auth helpers, backed by this app's admin
// session (see lib/session.ts).

export async function getSession() {
  const session = await getCustomSession()
  if (!session) return null

  return {
    user: {
      id: session.id,
      email: session.email,
      name: session.name,
      role: session.role,
      staffId: session.staffId,
    },
  }
}

export async function requireAuth() {
  const session = await getSession()
  if (!session?.user) {
    throw new Error('Unauthorized')
  }
  return session
}

export async function requireRole(...roles: string[]) {
  const session = await requireAuth()
  if (!roles.includes(session.user.role)) {
    throw new Error('Forbidden')
  }
  return session
}
