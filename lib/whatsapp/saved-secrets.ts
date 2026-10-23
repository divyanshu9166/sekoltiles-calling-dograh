import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'

/**
 * Secrets the admin can save from WhatsApp Marketing Settings (encrypted
 * with ENCRYPTION_KEY). A value saved in Settings wins; when none is saved
 * the matching environment variable is used, as in the Furniture CRM.
 */
export type SecretSource = 'settings' | 'env' | 'none'

export function envMetaAppSecret(): string | undefined {
  return process.env.META_APP_SECRET?.trim() || undefined
}

export function envGeminiApiKey(): string | undefined {
  return (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)?.trim() || undefined
}

export function secretSource(saved: string | null | undefined, envValue: string | undefined): SecretSource {
  if (saved) return 'settings'
  return envValue ? 'env' : 'none'
}

/**
 * Validate a secret posted from Settings: a non-empty token without spaces
 * to save, or null to remove the saved one and fall back to the environment.
 */
export function parseSecretInput(
  value: unknown,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null) return { ok: true, value: null }
  if (typeof value !== 'string') return { ok: false, error: 'Expected a string or null' }
  const trimmed = value.trim()
  if (!trimmed) return { ok: false, error: 'Enter a value, or remove the saved one' }
  if (trimmed.length > 256 || /\s/.test(trimmed)) {
    return { ok: false, error: 'That does not look like a valid key (no spaces, up to 256 characters)' }
  }
  return { ok: true, value: trimmed }
}

export const ENCRYPTION_KEY_MISSING =
  'Could not encrypt the value. Set ENCRYPTION_KEY (64 hex characters) in the server .env and restart.'

/** Decrypt a saved secret; undefined when absent or unreadable with the current ENCRYPTION_KEY. */
export function decryptSavedSecret(saved: string | null | undefined, label: string): string | undefined {
  if (!saved) return undefined
  try {
    return decrypt(saved).trim() || undefined
  } catch (err) {
    console.warn(
      `[secrets] saved ${label} cannot be decrypted with the current ENCRYPTION_KEY; using the environment fallback:`,
      err instanceof Error ? err.message : err,
    )
    return undefined
  }
}

/**
 * App Secrets to check Meta webhook signatures against. Settings first,
 * otherwise META_APP_SECRET; an empty list means none is configured.
 */
export async function getMetaAppSecrets(): Promise<string[]> {
  const rows = await prisma.waWhatsappConfig.findMany({
    where: { app_secret: { not: null } },
    select: { app_secret: true },
  })
  const saved = rows
    .map((row) => decryptSavedSecret(row.app_secret, 'Meta App Secret'))
    .filter((secret): secret is string => Boolean(secret))
  if (saved.length > 0) return saved

  const env = envMetaAppSecret()
  return env ? [env] : []
}
