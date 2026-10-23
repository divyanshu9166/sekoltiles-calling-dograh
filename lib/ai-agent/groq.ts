/**
 * lib/ai-agent/groq.ts
 *
 * Thin wrapper around Groq's OpenAI-compatible Chat Completions API.
 * Groq serves open models (Llama, etc.) for free, and is already used by the
 * calling agent. Used here for the WhatsApp / social chatbot reply generation.
 *
 * NOTE: This is for CHAT generation only. Embeddings use Xenova/multilingual-
 * e5-small running locally via ONNX — see lib/ai-agent/embedder.ts.
 *
 * Reference: https://console.groq.com/docs/openai
 */

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1/chat/completions'

// Matches the model env used by the calling agent (docker-compose.yml).
export const DEFAULT_GROQ_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct'

export function getGroqModelName(): string {
  return (process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL).trim()
}

export function getGroqApiKey(): string {
  const rawKey = process.env.GROQ_API_KEY
  const key = rawKey?.trim().replace(/^['"]|['"]$/g, '')
  if (!key) {
    throw new Error(
      'GROQ_API_KEY is not set. Create a key at https://console.groq.com and add it to the VPS .env file.',
    )
  }
  return key
}

export interface GroqChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * Call Groq chat completions and return the assistant text.
 * Throws on non-2xx so the caller can fall back gracefully.
 */
export async function groqChat(opts: {
  messages: GroqChatMessage[]
  maxTokens?: number
  temperature?: number
  topP?: number
}): Promise<string> {
  const { messages, maxTokens = 300, temperature = 0.3, topP = 0.8 } = opts

  const res = await fetch(GROQ_BASE_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getGroqApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: getGroqModelName(),
      messages,
      max_tokens: maxTokens,
      temperature,
      top_p: topP,
    }),
  })

  if (!res.ok) {
    const raw = await res.text()
    let message = raw
    try {
      const parsed = JSON.parse(raw) as { error?: { message?: string } }
      message = parsed.error?.message || raw
    } catch { /* keep raw */ }
    throw new Error(`Groq chat error ${res.status}: ${message}`)
  }

  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return data.choices?.[0]?.message?.content ?? ''
}
