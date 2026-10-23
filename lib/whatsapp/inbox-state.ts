import type { Message, MessageTemplate } from '@/types'

const statusOrder: Record<string, number> = { sending: 0, sent: 1, delivered: 2, read: 3 }
export function mergeMessage(current: Message, incoming: Partial<Message>): Message {
  const merged = { ...current, ...incoming }
  if (incoming.status && current.status !== 'failed' && incoming.status !== 'failed' && (statusOrder[current.status] ?? -1) > (statusOrder[incoming.status] ?? -1)) merged.status = current.status
  return merged
}

/** Only the acknowledged temp ID is removed; unrelated inbound messages never
 * consume pending sends. Server IDs deduplicate realtime/HTTP/poll races. */
export function mergeInboxMessages(current: Message[], incoming: Message[], conversationId: string, acknowledgedTempId?: string): Message[] {
  const byId = new Map<string, Message>()
  for (const message of current) {
    if (message.conversation_id === conversationId && message.id !== acknowledgedTempId) byId.set(message.id, message)
  }
  for (const message of incoming) {
    if (message.conversation_id !== conversationId) continue
    const existing = byId.get(message.id)
    byId.set(message.id, existing ? mergeMessage(existing, message) : message)
  }
  return [...byId.values()].sort((a, b) => (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0) || a.id.localeCompare(b.id))
}

export function customerSession(messages: Message[], now = Date.now()) {
  const times = messages.filter(message => message.sender_type === 'customer').map(message => Date.parse(message.created_at)).filter(Number.isFinite)
  if (!times.length) return { expired: true, remaining: 'No customer messages' }
  const latest = times.reduce((previous, time) => Math.max(previous, time), -Infinity)
  const remainingMs = Math.min(24 * 3600000, latest + 24 * 3600000 - now)
  if (remainingMs <= 0) return { expired: true, remaining: 'Expired' }
  const minutes = Math.ceil(remainingMs / 60000)
  return { expired: false, remaining: minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m remaining` : `${minutes}m remaining` }
}

export function templatePickerProblem(template: MessageTemplate): string | null {
  if (template.header_type && !['text'].includes(template.header_type)) return 'This template requires media header parameters not supported by this inbox picker.'
  if (template.header_content?.includes('{{') || template.buttons?.some(button => JSON.stringify(button).includes('{{') || button.type === 'OTP')) return 'This template needs header/button parameters. Use a body-only template in this picker.'
  const tokens = [...template.body_text.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map(match => match[1].trim())
  if (tokens.some(token => !/^[1-9]\d*$/.test(token))) return 'Named template variables are not supported by this picker.'
  const ids = [...new Set(tokens.map(Number))].sort((a, b) => a - b)
  return ids.some((id, index) => id !== index + 1) ? 'Template body variables must be numbered consecutively from 1.' : null
}
