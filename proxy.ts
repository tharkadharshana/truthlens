import { NextRequest, NextResponse } from 'next/server'

// Next 16: this file was renamed from middleware.ts. proxy runs on the Node
// runtime and is meant to be a THIN, optimistic gate — no DB calls here.
// We only check that a Supabase auth cookie exists; the REAL validation
// (getUser, which verifies the JWT) happens server-side in the dashboard page.
// This avoids the known logout-loop bug and keeps the proxy fast.
export function proxy(req: NextRequest) {
  const hasAuthCookie = req.cookies
    .getAll()
    .some((c) => c.name.startsWith('sb-') && c.name.includes('-auth-token'))

  if (!hasAuthCookie) {
    return NextResponse.redirect(new URL('/login?next=/dashboard', req.url))
  }
  return NextResponse.next()
}

export const config = { matcher: ['/dashboard/:path*'] }
