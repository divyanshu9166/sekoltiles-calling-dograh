import 'server-only'

import { getCurrentAdmin } from '@/lib/auth'

// Session adapter for the WhatsApp Marketing routes ported from the
// Furniture CRM. Those routes read `getSession()` from this module; here it
// resolves the signed-in admin from this app's database-backed session
// cookie, so WhatsApp uses the same login as the Call Center.

export interface SessionPayload {
  id: string
  email: string
  name: string
  role: string
  staffId: number | null
  expiresAt: Date
}

export async function getSession(): Promise<SessionPayload | null> {
  const admin = await getCurrentAdmin()
  if (!admin) return null

  return {
    id: String(admin.id),
    email: '',
    name: admin.username,
    // This app has a single admin role with full access.
    role: 'ADMIN',
    staffId: null,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  }
}
