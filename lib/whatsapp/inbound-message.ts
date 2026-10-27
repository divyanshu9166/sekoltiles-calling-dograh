// Readable text for inbound WhatsApp message types that carry no media, and
// the marketing opt-out keywords. Kept free of DB code so it can be unit tested.
//
// @see https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples

export interface InboundSharedContact {
  name?: { formatted_name?: string; first_name?: string; last_name?: string }
  phones?: Array<{ phone?: string; wa_id?: string }>
}

export interface InboundExtras {
  type: string
  /** Quick-reply button on a template (e.g. a broadcast's "Interested"). */
  button?: { payload?: string; text?: string }
  interactive?: {
    type?: string
    button_reply?: { id: string; title: string }
    list_reply?: { id: string; title: string; description?: string }
    nfm_reply?: { name?: string; body?: string; response_json?: string }
  }
  contacts?: InboundSharedContact[]
  order?: {
    text?: string
    product_items?: Array<{ product_retailer_id?: string; quantity?: number | string }>
  }
  system?: { body?: string; type?: string; wa_id?: string; new_wa_id?: string }
  errors?: Array<{ code?: number; title?: string; message?: string }>
}

function sharedContactLine(contact: InboundSharedContact) {
  const name =
    contact.name?.formatted_name ||
    [contact.name?.first_name, contact.name?.last_name].filter(Boolean).join(' ') ||
    'Contact'
  const phones = (contact.phones ?? [])
    .map((p) => p.phone || (p.wa_id ? `+${p.wa_id}` : ''))
    .filter(Boolean)
  return phones.length ? `${name}: ${phones.join(', ')}` : name
}

/**
 * Text to store for message types the media parser doesn't cover, or null
 * when the type isn't one of them.
 */
export function describeInboundExtras(message: InboundExtras): string | null {
  switch (message.type) {
    case 'button':
      return message.button?.text || message.button?.payload || '[Button reply]'

    case 'interactive': {
      const i = message.interactive
      if (i?.button_reply) return i.button_reply.title
      if (i?.list_reply) {
        return i.list_reply.description
          ? `${i.list_reply.title} (${i.list_reply.description})`
          : i.list_reply.title
      }
      if (i?.nfm_reply) return i.nfm_reply.body || `[Form submitted${i.nfm_reply.name ? `: ${i.nfm_reply.name}` : ''}]`
      return '[Interactive reply]'
    }

    case 'contacts': {
      const lines = (message.contacts ?? []).map(sharedContactLine)
      return lines.length ? `👤 Shared contact\n${lines.join('\n')}` : '👤 Shared contact'
    }

    case 'order': {
      const items = message.order?.product_items ?? []
      const count = items.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0)
      const summary = `🛒 Order: ${count} item${count === 1 ? '' : 's'}`
      return message.order?.text ? `${summary}\n${message.order.text}` : summary
    }

    case 'system':
      if (isChangedNumberNotice(message.system?.type) && message.system?.wa_id) {
        return `ℹ️ Customer changed their number to +${message.system.wa_id}`
      }
      return `ℹ️ ${message.system?.body || 'System update'}`

    case 'request_welcome':
      return '👋 Opened the chat'

    case 'unsupported':
    case 'unknown': {
      const reason = message.errors?.[0]?.title
      return `[Message type WhatsApp can't show here${reason ? `: ${reason}` : ''}]`
    }

    default:
      return null
  }
}

/** Meta's notice that the customer moved to a new number (`system.wa_id`). */
export function isChangedNumberNotice(type: string | undefined) {
  // `customer_changed_number` is the older name for the same event.
  return type === 'user_changed_number' || type === 'customer_changed_number'
}

/** What the customer tapped, so keyword automations and the AI agent can treat it like typed text. */
export function inboundReplyText(message: InboundExtras): string | null {
  if (message.type === 'button') return message.button?.text || message.button?.payload || null
  if (message.type === 'interactive') {
    return message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || null
  }
  return null
}

// Exact-match keywords only, so "please stop calling after 6" or "cancel my
// visit" never unsubscribes anyone by accident.
const OPT_OUT_KEYWORDS = new Set([
  'stop',
  'stop all',
  'stop promotions',
  'stop messages',
  'unsubscribe',
  'unsub',
  'opt out',
  'optout',
])
const OPT_IN_KEYWORDS = new Set(['start', 'unstop', 'subscribe', 'opt in', 'optin'])

function normalizeKeyword(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isOptOutKeyword(text: string | null | undefined) {
  return !!text && OPT_OUT_KEYWORDS.has(normalizeKeyword(text))
}

export function isOptInKeyword(text: string | null | undefined) {
  return !!text && OPT_IN_KEYWORDS.has(normalizeKeyword(text))
}
