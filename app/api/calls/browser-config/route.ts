import { NextResponse } from 'next/server'

export async function GET() {
  const widgetUrl = process.env.NEXT_PUBLIC_DOGRAH_WIDGET_URL?.trim()
  if (!widgetUrl) {
    return NextResponse.json(
      { error: 'Dograh browser voice widget is not configured' },
      { status: 503 },
    )
  }

  return NextResponse.json({ widgetUrl })
}
