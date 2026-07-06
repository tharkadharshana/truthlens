import { NextRequest, NextResponse } from 'next/server'
import { serverClient } from '@/lib/db'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  if (code) {
    const supabase = await serverClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      return NextResponse.redirect(new URL('/login?error=auth', req.url))
    }
  }
  return NextResponse.redirect(new URL('/dashboard', req.url))
}
