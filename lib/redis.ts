import { Redis } from '@upstash/redis'

// ponytail: lazy singleton. Constructing at import time crashes the build when
// env vars aren't present during page-data collection. Build it on first use.
let _redis: Redis | null = null
export function getRedis(): Redis {
  if (!_redis) _redis = Redis.fromEnv()
  return _redis
}

export const GLOBAL_COUNTER_KEY = 'truthlens:global:requests'
