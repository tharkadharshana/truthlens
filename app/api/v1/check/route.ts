import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { checkLimit } from '@/lib/ratelimit'
import { runPipeline } from '@/lib/pipeline'
import { getDb } from '@/lib/db'
import { getRedis, GLOBAL_COUNTER_KEY } from '@/lib/redis'
import { hashKey, clientIp } from '@/lib/keys'
import { DOMAINS, DEFAULT_DOMAIN, isDomain, DISCLAIMER } from '@/lib/domains'
import { verifyTurnstileToken } from '@/lib/turnstile'

export const runtime = 'nodejs'        // pipeline uses node crypto + supabase-js
export const maxDuration = 60          // Vercel Pro allows 60s; Hobby caps at 10s

type KeyRow = { id: string; tier: string; revoked: boolean } | null

async function logUsage(params: {
  api_key_id: string | null
  identifier: string
  tier: 'free' | 'pro'
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
      endpoint: 'check',
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

  // ── Rate limit (identifier: key hash for pro, client IP for free) ──
  const identifier = keyRow ? hashKey(apiKey!) : clientIp(req)
  const limit = await checkLimit(identifier, tier)

  const rlHeaders = {
    'X-RateLimit-Limit': String(limit.limit),
    'X-RateLimit-Remaining': String(limit.remaining),
    'X-RateLimit-Reset': String(limit.reset),
  }

  if (!limit.success) {
    await logUsage({ api_key_id: keyRow?.id ?? null, identifier, tier, claims: 0, llm_calls: 0, status: 429 })
    return NextResponse.json(
      { error: 'Rate limit exceeded', reset: limit.reset, remaining: 0 },
      { status: 429, headers: rlHeaders }
    )
  }

  // ── Validate input at the trust boundary ───────────────────────────
  const body = await req.json().catch(() => null)
  if (!body || typeof body.text !== 'string') {
    await logUsage({ api_key_id: keyRow?.id ?? null, identifier, tier, claims: 0, llm_calls: 0, status: 400 })
    return NextResponse.json({ error: 'Body must be JSON with a "text" string field' }, { status: 400, headers: rlHeaders })
  }
  const text = body.text.trim()
  if (text.length < 10) {
    return NextResponse.json({ error: 'text must be at least 10 characters' }, { status: 400, headers: rlHeaders })
  }
  if (text.length > 5000) {
    return NextResponse.json({ error: 'text exceeds 5000 character limit' }, { status: 400, headers: rlHeaders })
  }
  const domain = body.domain ?? DEFAULT_DOMAIN
  if (!isDomain(domain)) {
    return NextResponse.json(
      { error: `domain must be one of: ${Object.keys(DOMAINS).join(', ')}` },
      { status: 400, headers: rlHeaders }
    )
  }

  // ── Turnstile (free tier only — a key already proves you're not an
  // anonymous browser script). Verifies a token if one was sent; only
  // *requires* one when TURNSTILE_REQUIRE_FOR_ANONYMOUS=true, since the
  // public "no key needed" curl-able API would otherwise break for every
  // non-browser caller. See memory: production-readiness-gaps item 10. ──
  if (!keyRow) {
    const token = typeof body.turnstileToken === 'string' ? body.turnstileToken : undefined
    const required = process.env.TURNSTILE_REQUIRE_FOR_ANONYMOUS === 'true'
    if (token || required) {
      const ok = await verifyTurnstileToken(token, identifier)
      if (!ok) {
        await logUsage({ api_key_id: null, identifier, tier, claims: 0, llm_calls: 0, status: 403 })
        return NextResponse.json({ error: 'Turnstile verification failed' }, { status: 403, headers: rlHeaders })
      }
    }
  }

  // ── Run pipeline ───────────────────────────────────────────────────
  try {
    const result = await runPipeline(text, domain)

    await getRedis().incr(GLOBAL_COUNTER_KEY)
    if (keyRow) {
      await getDb().from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyRow.id)
    }
    await logUsage({
      api_key_id: keyRow?.id ?? null,
      identifier,
      tier,
      claims: result.claims.length,
      llm_calls: result.llm_calls,
      status: 200,
    })

    return NextResponse.json(
      {
        overall_score: result.overall_score,
        claims: result.claims,
        truncated: result.truncated,
        remaining: limit.remaining,
        disclaimer: DISCLAIMER,
      },
      { headers: rlHeaders }
    )
  } catch (e) {
    console.error('pipeline error', e)
    Sentry.captureException(e)
    await logUsage({ api_key_id: keyRow?.id ?? null, identifier, tier, claims: 0, llm_calls: 0, status: 500 })
    return NextResponse.json({ error: 'Verification failed' }, { status: 500, headers: rlHeaders })
  }
}

// Reject non-POST cleanly
export async function GET() {
  return NextResponse.json({ error: 'Use POST' }, { status: 405 })
}
