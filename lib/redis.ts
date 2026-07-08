import { Redis } from '@upstash/redis'

// ponytail: lazy singleton. Constructing at import time crashes the build when
// env vars aren't present during page-data collection. Build it on first use.
//
// Vercel's native Upstash/KV Marketplace integration injects KV_REST_API_URL /
// KV_REST_API_TOKEN instead of the plain UPSTASH_REDIS_REST_* names — same
// Upstash REST API underneath, just a different env var prefix depending on
// how the integration was attached. Accept either.
let _redis: Redis | null = null
export function getRedis(): Redis {
  if (!_redis) {
    const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL
    const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN
    if (!url || !token) {
      throw new Error('Missing Redis env vars: set UPSTASH_REDIS_REST_URL/_TOKEN or KV_REST_API_URL/_TOKEN')
    }
    _redis = new Redis({ url, token })
  }
  return _redis
}

export const GLOBAL_COUNTER_KEY = 'truthlens:global:requests'
