import { Ratelimit } from '@upstash/ratelimit'
import { getRedis } from './redis'
import { PLANS, type PlanId } from './plans'

// One sliding-window limiter per plan, sized from PLANS[planId].rateLimitPerHour
// — that's the single source of truth for the numbers (lib/plans.ts), not
// duplicated here. ponytail: lazy + a small Map since PlanId is a fixed, tiny
// set. Built on first use so module import doesn't touch Redis env at build time.
const limiters = new Map<PlanId, Ratelimit>()

function limiterFor(plan: PlanId): Ratelimit {
  let l = limiters.get(plan)
  if (!l) {
    l = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(PLANS[plan].rateLimitPerHour, '1 h'),
      prefix: `rl:${plan}`,
      analytics: true,
    })
    limiters.set(plan, l)
  }
  return l
}

export type LimitResult = { success: boolean; remaining: number; reset: number; limit: number }

export async function checkLimit(identifier: string, plan: PlanId): Promise<LimitResult> {
  const { success, remaining, reset, limit } = await limiterFor(plan).limit(identifier)
  return { success, remaining, reset, limit }
}
