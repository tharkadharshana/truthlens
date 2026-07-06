import { Ratelimit } from '@upstash/ratelimit'
import { getRedis } from './redis'

// ponytail: lazy limiters. Built on first use so module import doesn't touch
// Redis env at build time. Two fixed tiers — if Enterprise lands, key by a Map.
let _free: Ratelimit | null = null
let _pro: Ratelimit | null = null

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

export type LimitResult = { success: boolean; remaining: number; reset: number; limit: number }

export async function checkLimit(identifier: string, tier: 'free' | 'pro'): Promise<LimitResult> {
  const limiter = tier === 'pro' ? proLimit() : freeLimit()
  const { success, remaining, reset, limit } = await limiter.limit(identifier)
  return { success, remaining, reset, limit }
}
