import { Checkout } from '@polar-sh/nextjs'
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/auth'

export const runtime = 'nodejs'

// Redirects a signed-in user into Polar's hosted checkout for the requested
// plan. externalCustomerId is set to our own user id, which is how the
// webhook (app/api/webhooks/polar) maps the resulting subscription back to a
// profile — Polar never needs to know our schema, we just need that one id
// round-tripped.
export async function GET(req: NextRequest) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.redirect(new URL('/login', req.url))

  const planParam = req.nextUrl.searchParams.get('plan')
  const productId =
    planParam === 'business' ? process.env.POLAR_PRODUCT_BUSINESS
    : planParam === 'pro' ? process.env.POLAR_PRODUCT_PRO
    : null

  if (!productId) {
    return NextResponse.json({ error: 'plan must be "pro" or "business"' }, { status: 400 })
  }

  const url = new URL(req.url)
  url.searchParams.set('products', productId)
  url.searchParams.set('customerExternalId', user.id)
  url.searchParams.set('customerEmail', user.email ?? '')

  const handler = Checkout({
    accessToken: process.env.POLAR_ACCESS_TOKEN,
    successUrl: `${url.origin}/dashboard?checkout=success`,
    server: (process.env.POLAR_SERVER as 'sandbox' | 'production') ?? 'sandbox',
  })
  return handler(new NextRequest(url, req))
}
