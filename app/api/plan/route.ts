import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getAuthedUser } from '@/lib/auth'
import { FREE_PLAN, PLANS, type PlanId } from '@/lib/plans'

export const runtime = 'nodejs'

// Current billing state for the dashboard. Read-only — plan is written only by
// the Polar webhook (app/api/webhooks/polar), never by this route or the user.
export async function GET() {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await getDb()
    .from('profiles')
    .select('plan, subscription_status, current_period_end')
    .eq('id', user.id)
    .maybeSingle()

  const plan = (data?.plan as PlanId) ?? FREE_PLAN
  return NextResponse.json({
    plan,
    label: PLANS[plan].label,
    subscription_status: data?.subscription_status ?? null,
    current_period_end: data?.current_period_end ?? null,
  })
}
