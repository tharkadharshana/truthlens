import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { checkLimit, type Tier } from '@/lib/ratelimit'
import { runPipeline, type ClaimResult } from '@/lib/pipeline'
import { getDb } from '@/lib/db'
import { getRedis, GLOBAL_COUNTER_KEY, FREE_DAILY_CAP, globalDailyKey } from '@/lib/redis'
import { hashKey, clientIp } from '@/lib/keys'
import { DOMAINS, DEFAULT_DOMAIN, isDomain, DISCLAIMER, type Domain } from '@/lib/domains'
import { verifyTurnstileToken } from '@/lib/turnstile'

export const runtime = 'nodejs'        // pipeline uses node crypto + supabase-js
export const maxDuration = 60          // Vercel Pro allows 60s; Hobby caps at 10s

type KeyRow = { id: string; tier: string; revoked: boolean } | null

// Anonymous requests are capped to fewer claims than the MAX_CLAIMS a keyed
// caller gets. Bounds the paid Tavily/GNews spend on the free tier (one search
// runs per extracted claim) without touching answer quality on short inputs.
const FREE_MAX_CLAIMS = 3

// Cache freshness: general facts/news move fast, corpus law is stable.
const CACHE_MAX_AGE_SECONDS: Record<Domain, number> = {
  general: 60 * 60 * 24,       // 24h
  legal_statute: 60 * 60 * 24 * 7,   // 7d
  finra_compliance: 60 * 60 * 24 * 7, // 7d
}

// Shown to anonymous callers only. Sells volume + API access, not answer
// quality — the free demo deliberately returns the same verdicts a paid key
// would, because a weak demo converts nobody.
const UPGRADE_HINT =
  'Free tier is limited to 5 checks per hour. Get a free API key for 1,000/hour, programmatic access, saved history, and the Legal and FINRA compliance modes.'

// Normalize before hashing: trim + collapse whitespace. Case is preserved (it
// can carry meaning). Namespaced by domain AND tier: the free tier caps claims
// lower than a keyed caller, so their results genuinely differ and must not
// share a cache entry (a free 3-claim result would otherwise be served to a
// paid caller who should get the full set, and vice versa).
function inputHash(text: string, domain: Domain, tier: string): string {
  const normalized = text.trim().replace(/\s+/g, ' ')
  return hashKey(`${normalized} ${domain} ${tier}`)
}

function withPercentages(claims: ClaimResult[]) {
  return claims.map((c) => ({
    ...c,
    truth_percentage: typeof c.truth_score === 'number' ? Math.round(c.truth_score * 100) : null,
  }))
}

async function logUsage(params: {
  api_key_id: string | null
  identifier: string
  tier: 'free' | 'pro'
  domain: Domain
  claims: number
  llm_calls: number
  status: number
}) {
  // Best-effort — never block the response on logging, but await so serverless
  // doesn't kill the write mid-flight.
  try {
    await getDb().from('usage_logs').insert({
      api_key_id: params.api_key_id,
      identifier: params.identifier,
      tier: params.tier,
      endpoint: `check:${params.domain}`,  // per-domain analytics, no schema change
      claims_processed: params.claims,
      llm_calls: params.llm_calls,
      status_code: params.status,
    })
  } catch (e) {
    console.error('usage log failed', e)
    Sentry.captureException(e)
  }
}

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key')
  let tier: 'free' | 'pro' = 'free'
  let keyRow: KeyRow = null

  // ── Resolve API key by HASH (never compare plaintext) ──────────────
  if (apiKey) {
    const { data } = await getDb()
      .from('api_keys')
      .select('id, tier, revoked')
      .eq('key_hash', hashKey(apiKey))
      .maybeSingle()

    if (!data || data.revoked) {
      return NextResponse.json({ error: 'Invalid or revoked API key' }, { status: 401 })
    }
    tier = 'pro'
    keyRow = data
  }

  // ── Validate input at the trust boundary ───────────────────────────
  const body = await req.json().catch(() => null)
  const domain: Domain = body?.domain ?? DEFAULT_DOMAIN
  if (body?.domain !== undefined && !isDomain(body.domain)) {
    return NextResponse.json(
      { error: `domain must be one of: ${Object.keys(DOMAINS).join(', ')}` },
      { status: 400 }
    )
  }

  // ── Rate limit ─────────────────────────────────────────────────────
  // General free-tier gets its own tighter limiter (search-quota + upgrade
  // nudge); everything else keeps the existing free/pro limiters.
  const identifier = keyRow ? hashKey(apiKey!) : clientIp(req)
  const limitTier: Tier = keyRow ? 'pro' : domain === 'general' ? 'general_free' : 'free'
  const limit = await checkLimit(identifier, limitTier)

  const rlHeaders = {
    'X-RateLimit-Limit': String(limit.limit),
    'X-RateLimit-Remaining': String(limit.remaining),
    'X-RateLimit-Reset': String(limit.reset),
  }

  if (!limit.success) {
    await logUsage({ api_key_id: keyRow?.id ?? null, identifier, tier, domain, claims: 0, llm_calls: 0, status: 429 })
    return NextResponse.json(
      { error: 'Rate limit exceeded', reset: limit.reset, remaining: 0 },
      { status: 429, headers: rlHeaders }
    )
  }

  // ── Paywall: compliance domains are the paid product ───────────────
  // The free no-signup tier is general-only. DEFAULT_DOMAIN is a corpus domain,
  // so a keyless caller who omits `domain` lands here — point them at general.
  if (DOMAINS[domain].proOnly && !keyRow) {
    await logUsage({ api_key_id: null, identifier, tier, domain, claims: 0, llm_calls: 0, status: 401 })
    return NextResponse.json(
      { error: `The "${domain}" domain requires an API key. Use domain "general" for free access, or get a key at /login.` },
      { status: 401, headers: rlHeaders }
    )
  }

  if (!body || typeof body.text !== 'string') {
    await logUsage({ api_key_id: keyRow?.id ?? null, identifier, tier, domain, claims: 0, llm_calls: 0, status: 400 })
    return NextResponse.json({ error: 'Body must be JSON with a "text" string field' }, { status: 400, headers: rlHeaders })
  }
  const text = body.text.trim()
  if (text.length < 10) {
    return NextResponse.json({ error: 'text must be at least 10 characters' }, { status: 400, headers: rlHeaders })
  }
  if (text.length > 5000) {
    return NextResponse.json({ error: 'text exceeds 5000 character limit' }, { status: 400, headers: rlHeaders })
  }

  // ── Turnstile (free tier only — see lib/turnstile.ts) ──────────────
  if (!keyRow) {
    const token = typeof body.turnstileToken === 'string' ? body.turnstileToken : undefined
    const required = process.env.TURNSTILE_REQUIRE_FOR_ANONYMOUS === 'true'
    if (token || required) {
      const ok = await verifyTurnstileToken(token, identifier)
      if (!ok) {
        await logUsage({ api_key_id: null, identifier, tier, domain, claims: 0, llm_calls: 0, status: 403 })
        return NextResponse.json({ error: 'Turnstile verification failed' }, { status: 403, headers: rlHeaders })
      }
    }
  }

  // Every tier gets the full evidence stack. The free no-signup demo IS the
  // sales pitch — a deliberately weakened one produces bad verdicts and sells
  // nothing. Tiers differ on VOLUME (5/hr vs 1000/hr), API access, history and
  // domains, not on answer quality. Affordable because evidence is now pooled
  // per request rather than searched per claim.
  const fullEvidence = true
  // Cache namespace differs by tier because the claim cap does (see inputHash).
  const hash = inputHash(text, domain, keyRow ? 'keyed' : 'free')

  // ── Response cache: identical input within the freshness window ────
  // supabase-js returns { error } instead of throwing, so check it explicitly.
  // Cache is an optimization — any failure just falls through to a live run
  // (e.g. before the migration adds the checks table + lookup RPC).
  try {
    const { data: cached, error: cacheErr } = await getDb().rpc('lookup_cached_check', {
      p_input_hash: hash,
      p_max_age_seconds: CACHE_MAX_AGE_SECONDS[domain],
    })
    if (cacheErr) {
      console.error('cache lookup failed', cacheErr.message)
    } else {
      const hit = Array.isArray(cached) ? cached[0] : cached
      if (hit?.response) {
        await logUsage({ api_key_id: keyRow?.id ?? null, identifier, tier, domain, claims: 0, llm_calls: 0, status: 200 })
        return NextResponse.json(
          { ...hit.response, remaining: limit.remaining, cached: true, cached_at: hit.created_at },
          { headers: rlHeaders }
        )
      }
    }
  } catch (e) {
    console.error('cache lookup threw', e)
    Sentry.captureException(e)
  }

  // ── Global daily circuit breaker (anonymous only, cache-miss only) ──
  // Per-IP limits can't stop IP rotation; this global ceiling can. Only cache
  // misses reach here, so cached repeats of an attack stay free. Fails OPEN: a
  // broken counter must not take down the free tier (the per-IP limit still
  // applies). Keyed callers are exempt — they pay and have their own limit.
  if (!keyRow) {
    try {
      const redis = getRedis()
      const dayKey = globalDailyKey()
      const count = await redis.incr(dayKey)
      if (count === 1) await redis.expire(dayKey, 60 * 60 * 48) // auto-reset, 48h TTL
      if (count > FREE_DAILY_CAP) {
        await logUsage({ api_key_id: null, identifier, tier, domain, claims: 0, llm_calls: 0, status: 503 })
        return NextResponse.json(
          {
            error: `The free demo has reached today's shared capacity of ${FREE_DAILY_CAP} checks. ` +
              `Get a free API key for uninterrupted access, or try again tomorrow.`,
            at_capacity: true,
          },
          { status: 503, headers: rlHeaders }
        )
      }
    } catch (e) {
      console.error('daily cap check failed', e)
      Sentry.captureException(e)
    }
  }

  // ── Run pipeline ───────────────────────────────────────────────────
  try {
    const result = await runPipeline(text, domain, {
      fullEvidence,
      maxClaims: keyRow ? undefined : FREE_MAX_CLAIMS,
    })

    // The payload we both return and persist (volatile fields added per-request).
    const payload = {
      overall_score: result.overall_score,
      overall_percentage: result.overall_score === null ? null : Math.round(result.overall_score * 100),
      claims: withPercentages(result.claims),
      truncated: result.truncated,
      evidence_level: 'full',   // retained for API compatibility
      disclaimer: DISCLAIMER,
      // Anonymous callers get the same answer quality, so the nudge is about
      // volume and features rather than a degraded result.
      ...(keyRow ? {} : { upgrade_hint: UPGRADE_HINT }),
    }

    await getRedis().incr(GLOBAL_COUNTER_KEY)
    if (keyRow) {
      await getDb().from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyRow.id)
    }
    await logUsage({
      api_key_id: keyRow?.id ?? null,
      identifier,
      tier,
      domain,
      claims: result.claims.length,
      llm_calls: result.llm_calls,
      status: 200,
    })

    // Persist for history + shared cache. Best-effort: a failed save never
    // fails the check (same pattern as logUsage). supabase-js returns { error }
    // rather than throwing, so check it explicitly.
    //
    // Never persist a run containing ERROR verdicts. ERROR means an internal or
    // provider failure, not an answer — caching it poisons the shared cache and
    // replays that outage to everyone asking the same question for the whole
    // TTL. This is not hypothetical: a window where production was missing its
    // LLM keys cached ERROR results that kept being served after the keys were
    // fixed. UNVERIFIABLE is a real verdict and stays cacheable.
    const hasErrorVerdict = result.claims.some((c) => c.verdict === 'ERROR')
    if (hasErrorVerdict) {
      console.error('skipping cache write: response contains ERROR verdict(s)')
    } else {
      try {
        const { error: persistErr } = await getDb().from('checks').insert({
          api_key_id: keyRow?.id ?? null,
          domain,
          input_text: text,
          input_hash: hash,
          evidence_level: 'full',
          response: payload,
          overall_score: result.overall_score,
        })
        if (persistErr) console.error('check persist failed', persistErr.message)
      } catch (e) {
        console.error('check persist threw', e)
        Sentry.captureException(e)
      }
    }

    return NextResponse.json(
      { ...payload, remaining: limit.remaining, cached: false },
      { headers: rlHeaders }
    )
  } catch (e) {
    console.error('pipeline error', e)
    Sentry.captureException(e)
    await logUsage({ api_key_id: keyRow?.id ?? null, identifier, tier, domain, claims: 0, llm_calls: 0, status: 500 })
    return NextResponse.json({ error: 'Verification failed' }, { status: 500, headers: rlHeaders })
  }
}

// Reject non-POST cleanly
export async function GET() {
  return NextResponse.json({ error: 'Use POST' }, { status: 405 })
}
