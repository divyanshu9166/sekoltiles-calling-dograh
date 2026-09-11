import { checkDograhHealth } from '@/lib/dograh'

export async function callingAgentStatus(
  env: Record<string, string | undefined> = process.env,
  request: typeof fetch = fetch,
) {
  const hasDograh = !!env.DOGRAH_API_URL
  const hasApiKey = !!env.DOGRAH_API_KEY
  const hasWorkflow = !!env.DOGRAH_WORKFLOW_UUID
  const hasWebWidget = !!env.NEXT_PUBLIC_DOGRAH_WIDGET_URL
  const hasVobiz = env.DOGRAH_TELEPHONY_PROVIDER?.toLowerCase() === 'vobiz'
  const configured = hasDograh && hasApiKey && hasWorkflow

  let workerOnline = false
  if (hasDograh) {
    try {
      workerOnline = await checkDograhHealth(env, request)
    } catch {
      workerOnline = false
    }
  }

  return {
    configured,
    workerOnline,
    healthUrl: null,
    agentName: env.DOGRAH_AGENT_NAME || 'Anushka',
    model: 'Dograh workflow',
    dograhUrl: hasDograh ? env.DOGRAH_API_URL : null,
    hasDograh,
    hasApiKey,
    hasWorkflow,
    hasWebWidget,
    hasVobiz,
  }
}
