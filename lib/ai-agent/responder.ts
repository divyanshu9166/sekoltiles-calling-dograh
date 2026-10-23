/**
 * lib/ai-agent/responder.ts
 *
 * Sends a filled prompt to Gemini and parses the reply.
 * Returns the cleaned reply text plus two boolean signals:
 *   needsHandoff  — model asked to escalate to a human
 *   confidenceOk  — model did NOT say it lacks information
 *
 * Chat generation: Gemini 3.5 Flash-Lite (Google AI Studio API)
 * Embeddings:      Xenova/multilingual-e5-small (local ONNX) — see embedder.ts
 */

import { buildPrompt, type BuildPromptParams } from './system-prompt'
import { geminiChat } from './gemini'

export interface AgentResponse {
  text: string
  needsHandoff: boolean
  confidenceOk: boolean
}

/** Parse raw LLM output into structured signals. */
function parseAgentReply(rawText: string): AgentResponse {
  const needsHandoff = rawText.includes('[HANDOFF_NEEDED]')
  const cleanText = rawText.replace('[HANDOFF_NEEDED]', '').trim()
  const confidenceOk = !rawText.toLowerCase().includes("don't have that information")
  return { text: cleanText, needsHandoff, confidenceOk }
}

/**
 * Generate an AI agent reply using Gemini.
 *
 * The full prompt (system rules + knowledge + history + customer message)
 * is assembled by buildPrompt() and sent as a single user turn.
 */
export async function generateResponse(
  params: BuildPromptParams & { maxTokens?: number; apiKey?: string },
): Promise<AgentResponse> {
  const prompt = buildPrompt(params)
  const maxTokens = params.maxTokens ?? 300

  const rawText = await geminiChat({
    prompt,
    maxTokens,
    temperature: 0.3,
    topP: 0.8,
    apiKey: params.apiKey,
  })

  return parseAgentReply(rawText)
}
