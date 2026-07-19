import { Ratelimit } from '@upstash/ratelimit'
import { getRedis } from './redis'

// ponytail: lazy limiters. Built on first use so module import doesn't touch
// Redis env at build time. Two fixed tiers — if Enterprise lands, key by a Map.
let _free: Ratelimit | null = null
let _pro: Ratelimit | null = null
let _generalFree: Ratelimit | null = null

function freeLimit(): Ratelimit {
  if (!_free) {
    _free = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(10, '1 h'),
      prefix: 'rl:free',
      analytics: true,
    })
  }
  return _free
}

function proLimit(): Ratelimit {
  if (!_pro) {
    _pro = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(1000, '1 h'),
      prefix: 'rl:pro',
      analytics: true,
    })
  }
  return _pro
}

// Free general fact-checking is deliberately tighter than the free legal tier —
// it burns external search quota, and the low cap is the upgrade nudge.
function generalFreeLimit(): Ratelimit {
  if (!_generalFree) {
    _generalFree = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(5, '1 h'),
      prefix: 'rl:gfree',
      analytics: true,
    })
  }
  return _generalFree
}

export type Tier = 'free' | 'pro' | 'general_free'
export type LimitResult = { success: boolean; remaining: number; reset: number; limit: number }

export async function checkLimit(identifier: string, tier: Tier): Promise<LimitResult> {
  const limiter = tier === 'pro' ? proLimit() : tier === 'general_free' ? generalFreeLimit() : freeLimit()
  const { success, remaining, reset, limit } = await limiter.limit(identifier)
  return { success, remaining, reset, limit }
}
