import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// This is only an optimistic page redirect. Every server action and browser
// API still performs its own database-backed session check.
export function proxy(request: NextRequest) {
  if (!request.cookies.has('sekol_session')) {
    const loginUrl = new URL('/auth/login', request.url)
    loginUrl.searchParams.set('next', request.nextUrl.pathname)
    return NextResponse.redirect(loginUrl)
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/', '/calls/:path*'],
}
