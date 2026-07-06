import { NextResponse } from 'next/server'
import { getRedis, GLOBAL_COUNTER_KEY } from '@/lib/redis'

// Fix vs v1: route handlers aren't ISR — use explicit Cache-Control so we don't
// hammer Redis on every landing-page poll. 10s shared cache is plenty.
export async function GET() {
  const total = (await getRedis().get<number>(GLOBAL_COUNTER_KEY)) ?? 0
  return NextResponse.json(
    { total_requests: total },
    { headers: { 'Cache-Control': 's-maxage=10, stale-while-revalidate=30' } }
  )
}
