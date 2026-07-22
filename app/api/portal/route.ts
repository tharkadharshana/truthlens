import { CustomerPortal } from '@polar-sh/nextjs'
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/auth'

export const runtime = 'nodejs'

// Sends a signed-in paying user to Polar's hosted portal to manage/cancel
// their subscription. Looked up by the same external id used at checkout —
// our own user id — so no separate customer-id storage is required to route
// them there (the webhook still records polar_customer_id for reference).
export const GET = async (req: NextRequest) => {
  const user = await getAuthedUser()
  if (!user) return NextResponse.redirect(new URL('/login', req.url))

  const handler = CustomerPortal({
    accessToken: process.env.POLAR_ACCESS_TOKEN ?? '',
    server: (process.env.POLAR_SERVER as 'sandbox' | 'production') ?? 'sandbox',
    getExternalCustomerId: async () => user.id,
  })
  return handler(req)
}
