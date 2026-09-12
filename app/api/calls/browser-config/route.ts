import { NextResponse } from 'next/server'
import { getCurrentAdmin } from '@/lib/auth'

export async function GET() {
  if (!await getCurrentAdmin()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const widgetUrl = process.env.NEXT_PUBLIC_DOGRAH_WIDGET_URL?.trim()
  if (!widgetUrl) {
    return NextResponse.json(
      { error: 'Dograh browser voice widget is not configured' },
      { status: 503 },
    )
  }

  return NextResponse.json({ widgetUrl })
}
