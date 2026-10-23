/**
 * Gemini REST client for the WhatsApp, Instagram and Facebook chatbots.
 * Uses Google AI Studio's Gemini API directly, keeping the chatbot runtime
 * dependency-free and independent from the separate voice-agent service.
 */

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite'

export function getGeminiModelName(): string {
  return (process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim()
}

/** `savedKey` comes from WhatsApp Marketing → AI Agent settings and wins over the environment. */
export function getGeminiApiKey(savedKey?: string): string {
  const rawKey = savedKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
  const key = rawKey?.trim().replace(/^['"]|['"]$/g, '')
  if (!key) {
    throw new Error(
      'Gemini API key is not set. Save one in WhatsApp Marketing → AI Agent → Configuration, or set GEMINI_API_KEY in the server environment.',
    )
  }
  return key
}

interface GeminiPart {
  text?: string
  thought?: boolean
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] }
    finishReason?: string
  }>
  promptFeedback?: { blockReason?: string }
  error?: { message?: string }
}

/** Generate one concise chatbot response with Gemini 3.5 Flash-Lite. */
export async function geminiChat(opts: {
  prompt: string
  maxTokens?: number
  temperature?: number
  topP?: number
  /** Key saved in AI Agent settings; falls back to GEMINI_API_KEY. */
  apiKey?: string
}): Promise<string> {
  const { prompt, maxTokens = 300, temperature = 0.3, topP = 0.8, apiKey } = opts
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)

  try {
    const response = await fetch(
      `${GEMINI_API_BASE}/${encodeURIComponent(getGeminiModelName())}:generateContent`,
      {
        method: 'POST',
        headers: {
          'x-goog-api-key': getGeminiApiKey(apiKey),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature,
            topP,
            maxOutputTokens: maxTokens,
          },
        }),
        signal: controller.signal,
      },
    )

    const raw = await response.text()
    let data: GeminiResponse = {}
    try {
      data = JSON.parse(raw) as GeminiResponse
    } catch {
      // The status + a short body excerpt below is still useful for diagnosis.
    }

    if (!response.ok) {
      throw new Error(`Gemini chat error ${response.status}: ${data.error?.message || raw.slice(0, 500)}`)
    }

    const text = data.candidates?.[0]?.content?.parts
      ?.filter((part) => !part.thought)
      .map((part) => part.text || '')
      .join('')
      .trim()

    if (!text) {
      const reason = data.promptFeedback?.blockReason || data.candidates?.[0]?.finishReason || 'empty response'
      throw new Error(`Gemini returned no reply: ${reason}`)
    }

    return text
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Gemini chat request timed out after 20 seconds')
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}
