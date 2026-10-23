import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import {
  ENCRYPTION_KEY_MISSING,
  envMetaAppSecret,
  parseSecretInput,
  secretSource,
} from '@/lib/whatsapp/saved-secrets'

/**
 * GET /api/whatsapp/config
 *
 * Used by the "Test API Connection" button and by the page to check
 * whether the saved config is healthy. Returns 200 in all non-auth cases
 * so the UI can render an appropriate message rather than show a 500.
 *
 * Response shape:
 *   { connected: true,  phone_info: {...} }
 *   { connected: false, reason: 'no_config',        message: '...' }
 *   { connected: false, reason: 'token_corrupted',  message: '...', needs_reset: true }
 *   { connected: false, reason: 'meta_api_error',   message: '...' }
 */
export async function GET() {
  try {
    const session = await getSession()
    if (!session?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = String(session.id)

    const config = await prisma.waWhatsappConfig.findUnique({
      where: { user_id: userId },
    })

    if (!config) {
      return NextResponse.json(
        {
          connected: false,
          reason: 'no_config',
          message: 'No WhatsApp configuration saved yet. Fill in the form and click Save Configuration.',
          config: null,
        },
        { status: 200 }
      )
    }

    const safeConfig = {
      id: config.id,
      phone_number_id: config.phone_number_id,
      waba_id: config.waba_id,
      status: config.status,
      connected_at: config.connected_at?.toISOString() ?? null,
      created_at: config.created_at.toISOString(),
      updated_at: config.updated_at.toISOString(),
      has_access_token: Boolean(config.access_token),
      // Where webhook signatures are checked from; the secret itself is never returned.
      app_secret_source: secretSource(config.app_secret, envMetaAppSecret()),
    }

    // Try to decrypt the stored token with the current ENCRYPTION_KEY.
    // If this fails, the key changed (or was never consistent across envs).
    let accessToken: string
    try {
      accessToken = decrypt(config.access_token)
    } catch (err) {
      console.error('[whatsapp/config GET] Token decryption failed:', err)
      return NextResponse.json(
        {
          connected: false,
          reason: 'token_corrupted',
          needs_reset: true,
          message:
            'The stored access token cannot be decrypted with the current ENCRYPTION_KEY. This usually means the key changed, or it differs between environments (local vs Hostinger vs Vercel). Click "Reset Configuration" below, then re-save.',
          config: safeConfig,
        },
        { status: 200 }
      )
    }

    // Validate credentials against Meta
    try {
      const phoneInfo = await verifyPhoneNumber({
        phoneNumberId: config.phone_number_id,
        accessToken,
      })
      return NextResponse.json({ connected: true, phone_info: phoneInfo, config: safeConfig })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('[whatsapp/config GET] Meta API verification failed:', message)
      return NextResponse.json(
        {
          connected: false,
          reason: 'meta_api_error',
          message: `Meta API rejected the credentials: ${message}`,
          config: safeConfig,
        },
        { status: 200 }
      )
    }
  } catch (error) {
    console.error('Error in WhatsApp config GET:', error)
    return NextResponse.json(
      { connected: false, reason: 'unknown', message: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/whatsapp/config
 *
 * Saves or updates the WhatsApp config for the authenticated user.
 * Saves to database first, then optionally verifies with Meta.
 */
export async function POST(request: Request) {
  try {
    const session = await getSession()
    if (!session?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = String(session.id)

    let body: {
      phone_number_id?: string
      waba_id?: string
      access_token?: string
      verify_token?: string
    }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const { phone_number_id, waba_id, access_token, verify_token } = body

    if (!access_token || !phone_number_id) {
      return NextResponse.json(
        { error: 'access_token and phone_number_id are required' },
        { status: 400 }
      )
    }

    // Encrypt sensitive tokens before storing (best-effort — if ENCRYPTION_KEY
    // is missing we store the token as plaintext so the save never fails silently)
    let encryptedAccessToken: string
    let encryptedVerifyToken: string | null
    try {
      encryptedAccessToken = encrypt(access_token)
      encryptedVerifyToken = verify_token ? encrypt(verify_token) : null
    } catch (err) {
      console.warn('Encryption unavailable, storing token as-is:', err instanceof Error ? err.message : err)
      // Store as plaintext — better than blocking the user entirely
      encryptedAccessToken = access_token
      encryptedVerifyToken = verify_token || null
    }

    // Save to database first — always succeeds regardless of Meta status
    await prisma.waWhatsappConfig.upsert({
      where: { user_id: userId },
      create: {
        user_id: userId,
        phone_number_id,
        waba_id: waba_id || null,
        access_token: encryptedAccessToken,
        verify_token: encryptedVerifyToken,
        status: 'connected',
        connected_at: new Date(),
      },
      update: {
        phone_number_id,
        waba_id: waba_id || null,
        access_token: encryptedAccessToken,
        verify_token: encryptedVerifyToken,
        status: 'connected',
        connected_at: new Date(),
      },
    })

    // Now verify with Meta (best-effort — don't fail the save if Meta rejects)
    try {
      const phoneInfo = await verifyPhoneNumber({
        phoneNumberId: phone_number_id,
        accessToken: access_token,
      })
      return NextResponse.json({ success: true, phone_info: phoneInfo })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('Meta API verification failed after save:', message)
      // Config saved successfully — just tell the UI Meta verification failed
      return NextResponse.json({
        success: true,
        meta_warning: `Configuration saved. Meta API verification failed: ${message}. Check your Phone Number ID and Access Token.`,
      })
    }
  } catch (error) {
    console.error('Error in WhatsApp config POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/whatsapp/config
 *
 * Saves ({ app_secret: "..." }) or removes ({ app_secret: null }) the Meta
 * App Secret used to verify webhook signatures, without re-entering the
 * access token. Stored encrypted; when removed, META_APP_SECRET is used.
 */
export async function PATCH(request: Request) {
  try {
    const session = await getSession()
    if (!session?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = String(session.id)

    const body = (await request.json().catch(() => null)) as { app_secret?: unknown } | null
    if (!body || !('app_secret' in body)) {
      return NextResponse.json({ error: 'app_secret is required' }, { status: 400 })
    }
    const parsed = parseSecretInput(body.app_secret)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }

    const config = await prisma.waWhatsappConfig.findUnique({ where: { user_id: userId }, select: { id: true } })
    if (!config) {
      return NextResponse.json(
        { error: 'Save the WhatsApp configuration first, then add the App Secret.' },
        { status: 404 },
      )
    }

    let appSecret: string | null = null
    if (parsed.value) {
      try {
        appSecret = encrypt(parsed.value)
      } catch {
        return NextResponse.json({ error: ENCRYPTION_KEY_MISSING }, { status: 500 })
      }
    }

    await prisma.waWhatsappConfig.update({ where: { id: config.id }, data: { app_secret: appSecret } })

    return NextResponse.json({
      success: true,
      source: secretSource(appSecret, envMetaAppSecret()),
    })
  } catch (error) {
    console.error('Error in WhatsApp config PATCH:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/whatsapp/config
 *
 * Removes the authenticated user's WhatsApp configuration row.
 * Used by the "Reset Configuration" button to recover from a corrupted
 * encrypted token (mismatched ENCRYPTION_KEY across environments).
 */
export async function DELETE() {
  try {
    const session = await getSession()
    if (!session?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = String(session.id)
    await prisma.waWhatsappConfig.deleteMany({ where: { user_id: userId } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in WhatsApp config DELETE:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
