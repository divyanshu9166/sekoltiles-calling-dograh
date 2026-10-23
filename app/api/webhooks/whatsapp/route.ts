import { GET as handleWebhookGet, POST as handleWebhookPost } from '../../whatsapp/webhook/route'

// Legacy endpoint: forward to the main WhatsApp webhook handler so
// existing external webhook URLs keep working after the Prisma migration.
export async function GET(request: Request) {
  return handleWebhookGet(request)
}

export async function POST(request: Request) {
  return handleWebhookPost(request)
}
