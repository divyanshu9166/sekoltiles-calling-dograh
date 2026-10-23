import { prisma } from '@/lib/db'
import { engineSendText, engineSendTemplate } from '@/lib/automations/meta-send'
import { isSessionWindowOpen } from '@/lib/whatsapp/session-window'
import { normalizePhoneForMetaIndia, phoneVariants } from '@/lib/whatsapp/phone-utils'

// ------------------------------------------------------------
// Window-aware CRM → WhatsApp sender.
//
// Bridges a plain CRM phone number to the WhatsApp (Wa*) layer and sends:
//   • inside the 24h window  → free-form text (if `text` provided)
//   • outside the window     → the approved template (if `templateName` set)
//   • outside, no template   → skipped gracefully (never throws)
//
// It find-or-creates the WaContact + WaConversation, then delegates the
// actual Meta call + message persistence to the existing engineSend* helpers.
// ------------------------------------------------------------

export interface NotifyResult {
    sent: boolean
    skipped?: boolean
    reason?: string
    mode?: 'text' | 'template'
    messageId?: string
    error?: string
}

export interface NotifyArgs {
    phone: string
    name?: string | null
    /** Free-form text used only when the 24h window is open. */
    text?: string
    /** Approved Meta template name used when the window is closed. */
    templateName?: string | null
    language?: string
    /** Body ({{1}}, {{2}}…) variables for the template, in order. */
    templateParams?: string[]
}

/** Resolve the WhatsApp account to send from (single-tenant: the connected config). */
async function resolveConfig() {
    return (
        (await prisma.waWhatsappConfig.findFirst({ where: { status: 'connected' } })) ??
        (await prisma.waWhatsappConfig.findFirst())
    )
}

export async function notifyContactByWhatsApp(args: NotifyArgs): Promise<NotifyResult> {
    try {
        if (!args.phone) return { sent: false, skipped: true, reason: 'no phone' }

        const config = await resolveConfig()
        if (!config) return { sent: false, skipped: true, reason: 'WhatsApp not configured' }
        const userId = config.user_id

        const sanitized = normalizePhoneForMetaIndia(args.phone)
        const candidates = Array.from(new Set([args.phone, sanitized, ...phoneVariants(sanitized)]))

        // Find or create the WaContact for this account.
        let waContact = await prisma.waContact.findFirst({
            where: { user_id: userId, phone: { in: candidates } },
            select: { id: true },
        })
        if (!waContact) {
            waContact = await prisma.waContact.create({
                data: { user_id: userId, phone: sanitized, name: args.name || null },
                select: { id: true },
            })
        }

        // Find or create the conversation (unique per user_id + contact_id).
        let convo = await prisma.waConversation.findFirst({
            where: { user_id: userId, contact_id: waContact.id },
            select: { id: true },
        })
        if (!convo) {
            convo = await prisma.waConversation.create({
                data: { user_id: userId, contact_id: waContact.id, status: 'open' },
                select: { id: true },
            })
        }

        // Session window = time since the contact's last inbound (customer) message.
        const lastInbound = await prisma.waMessage.findFirst({
            where: { conversation_id: convo.id, sender_type: 'customer' },
            orderBy: { created_at: 'desc' },
            select: { created_at: true },
        })
        const windowOpen = isSessionWindowOpen(lastInbound?.created_at ?? null)

        if (windowOpen && args.text && args.text.trim()) {
            const r = await engineSendText({
                userId,
                conversationId: convo.id,
                contactId: waContact.id,
                text: args.text,
            })
            return { sent: true, mode: 'text', messageId: r.whatsapp_message_id }
        }

        if (args.templateName) {
            const r = await engineSendTemplate({
                userId,
                conversationId: convo.id,
                contactId: waContact.id,
                templateName: args.templateName,
                language: args.language,
                params: args.templateParams,
            })
            return { sent: true, mode: 'template', messageId: r.whatsapp_message_id }
        }

        return {
            sent: false,
            skipped: true,
            reason: 'Outside 24h window and no approved template configured',
        }
    } catch (err) {
        return { sent: false, error: err instanceof Error ? err.message : String(err) }
    }
}
