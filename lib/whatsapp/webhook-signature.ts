import crypto from 'node:crypto'

/**
 * Verify the HMAC-SHA256 signature Meta attaches to webhook POSTs.
 *
 * Meta signs the raw request body with your App Secret and sends the
 * result in the `x-hub-signature-256: sha256=<hex>` header. Without
 * verification, anyone who knows our webhook URL can POST fabricated
 * status updates and drift broadcast counts arbitrarily.
 *
 * Reference:
 *   https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verify-payloads
 *
 * Contract:
 *   An App Secret (WhatsApp Settings or META_APP_SECRET) is **required**. If it's missing we fail closed —
 *   every request is rejected until the operator configures the
 *   secret. A previous version fell open with a warning log, which is
 *   unsafe for a public template: anyone who forgets the env var would
 *   be running a fully spoofable webhook.
 */
export function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  /** App Secrets to accept (from WhatsApp Settings, see saved-secrets.ts).
   *  Omitted → META_APP_SECRET. */
  secrets?: string[],
): boolean {
  const envSecret = process.env.META_APP_SECRET
  const candidates = secrets ?? (envSecret ? [envSecret] : [])

  // No App Secret configured anywhere: fail closed, per the contract above.
  // Accepting unsigned requests would let anyone who knows the URL inject
  // fake customer messages (triggering bot/AI replies) or status updates.
  if (candidates.length === 0) {
    console.warn(
      '[webhook] No Meta App Secret configured — rejecting the request. ' +
        'Save it in WhatsApp Marketing → Settings → Webhook Security ' +
        '(or set META_APP_SECRET) to start receiving webhooks.',
    )
    return false
  }

  if (!signatureHeader) return false
  if (!signatureHeader.startsWith('sha256=')) return false

  const a = Buffer.from(signatureHeader)
  return candidates.some((secret) => {
    const expected =
      'sha256=' +
      crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
    const b = Buffer.from(expected)
    // Bail if lengths differ — timingSafeEqual throws otherwise.
    if (a.length !== b.length) return false
    return crypto.timingSafeEqual(a, b)
  })
}