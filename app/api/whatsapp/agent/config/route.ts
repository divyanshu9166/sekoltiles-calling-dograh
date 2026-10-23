import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth-helpers'
import { DEFAULT_SYSTEM_PROMPT } from '@/lib/ai-agent/system-prompt'
import { encrypt } from '@/lib/whatsapp/encryption'
import {
  ENCRYPTION_KEY_MISSING,
  envGeminiApiKey,
  parseSecretInput,
  secretSource,
} from '@/lib/whatsapp/saved-secrets'

/**
 * GET /api/whatsapp/agent/config
 * Returns the current user's AI agent configuration.
 * If no config exists, returns defaults.
 */
export async function GET() {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = String(session.user.id)
    const config = await prisma.waAgentConfig.findUnique({ where: { user_id: userId } })

    if (!config) {
      // Return defaults so the UI can show something sensible on first load
      return NextResponse.json({
        enabled: false,
        agent_name: 'Assistant',
        system_prompt: DEFAULT_SYSTEM_PROMPT,
        fallback_message: "Let me connect you with our team.",
        confidence_threshold: 0.45,
        max_response_tokens: 300,
        response_delay_ms: 1500,
        languages: ['en', 'hi'],
        gemini_key_source: secretSource(null, envGeminiApiKey()),
      })
    }

    return NextResponse.json({
      id: config.id,
      enabled: config.enabled,
      agent_name: config.agent_name,
      system_prompt: config.system_prompt,
      fallback_message: config.fallback_message,
      confidence_threshold: config.confidence_threshold,
      max_response_tokens: config.max_response_tokens,
      response_delay_ms: config.response_delay_ms,
      languages: config.languages,
      // Where the Gemini key comes from; the key itself is never returned.
      gemini_key_source: secretSource(config.gemini_api_key, envGeminiApiKey()),
      created_at: config.created_at.toISOString(),
      updated_at: config.updated_at.toISOString(),
    })
  } catch (error) {
    console.error('[agent/config GET]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/whatsapp/agent/config
 * Create or update the AI agent configuration for the current user.
 */
export async function POST(request: Request) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = String(session.user.id)

    let body: {
      enabled?: boolean
      agent_name?: string
      system_prompt?: string
      fallback_message?: string
      confidence_threshold?: number
      max_response_tokens?: number
      response_delay_ms?: number
      languages?: string[]
    }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const data = {
      enabled:              body.enabled              ?? false,
      agent_name:           body.agent_name           ?? 'Assistant',
      system_prompt:        body.system_prompt        ?? DEFAULT_SYSTEM_PROMPT,
      fallback_message:     body.fallback_message     ?? "Let me connect you with our team.",
      confidence_threshold: body.confidence_threshold ?? 0.45,
      max_response_tokens:  body.max_response_tokens  ?? 300,
      response_delay_ms:    body.response_delay_ms    ?? 1500,
      languages:            body.languages            ?? ['en', 'hi'],
    }

    const config = await prisma.waAgentConfig.upsert({
      where: { user_id: userId },
      create: { user_id: userId, ...data },
      update: data,
    })

    return NextResponse.json({ success: true, id: config.id })
  } catch (error) {
    console.error('[agent/config POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/whatsapp/agent/config
 * Saves ({ gemini_api_key: "..." }) or removes ({ gemini_api_key: null }) the
 * Gemini API key used for AI replies. Stored encrypted; when removed,
 * GEMINI_API_KEY from the server environment is used.
 */
export async function PATCH(request: Request) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = String(session.user.id)

    const body = (await request.json().catch(() => null)) as { gemini_api_key?: unknown } | null
    if (!body || !('gemini_api_key' in body)) {
      return NextResponse.json({ error: 'gemini_api_key is required' }, { status: 400 })
    }
    const parsed = parseSecretInput(body.gemini_api_key)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }

    let geminiApiKey: string | null = null
    if (parsed.value) {
      try {
        geminiApiKey = encrypt(parsed.value)
      } catch {
        return NextResponse.json({ error: ENCRYPTION_KEY_MISSING }, { status: 500 })
      }
    }

    // The agent config may not be saved yet; keep every other setting at its default.
    await prisma.waAgentConfig.upsert({
      where: { user_id: userId },
      create: { user_id: userId, system_prompt: DEFAULT_SYSTEM_PROMPT, gemini_api_key: geminiApiKey },
      update: { gemini_api_key: geminiApiKey },
    })

    return NextResponse.json({
      success: true,
      source: secretSource(geminiApiKey, envGeminiApiKey()),
    })
  } catch (error) {
    console.error('[agent/config PATCH]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
