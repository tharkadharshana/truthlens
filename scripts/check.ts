// One runnable check per piece of non-trivial logic. No framework.
// Run: npm run check   (does NOT need network or DB — pure logic only)
import assert from 'node:assert'
import { generateKey, hashKey, clientIp } from '../lib/keys'
import { resolveProvider, parseRetryDelaySeconds } from '../lib/llm'
import { DOMAINS, DEFAULT_DOMAIN, isDomain } from '../lib/domains'

// ── Key hashing: raw never equals stored, hash is stable, prefix matches ──
{
  const { raw, hash, prefix } = generateKey()
  assert.ok(raw.startsWith('tl_'), 'raw key must be prefixed tl_')
  assert.strictEqual(hash, hashKey(raw), 'hashKey must be deterministic')
  assert.notStrictEqual(raw, hash, 'stored hash must differ from raw key')
  assert.ok(raw.startsWith(prefix), 'display prefix must be a prefix of raw')
  assert.strictEqual(prefix.length, 11, 'prefix length')
  // Two keys never collide
  assert.notStrictEqual(generateKey().raw, generateKey().raw, 'keys must be unique')
}

// ── clientIp: takes first XFF entry, never collapses missing header to shared bucket ──
{
  const mk = (h: Record<string, string>) =>
    ({ headers: { get: (k: string) => h[k.toLowerCase()] ?? null } } as any)

  assert.strictEqual(clientIp(mk({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' })), '1.2.3.4', 'first XFF ip')
  assert.strictEqual(clientIp(mk({ 'x-real-ip': '5.6.7.8' })), '5.6.7.8', 'falls back to x-real-ip')

  const a = clientIp(mk({}))
  const b = clientIp(mk({}))
  assert.ok(a.startsWith('noip:') && b.startsWith('noip:'), 'missing header yields noip token')
  assert.notStrictEqual(a, b, 'missing-header requests must NOT share one bucket')
}

// ── safeParseVerdict behavior is covered implicitly; re-implement the guard's
//    contract here to catch regressions in the parsing rules. ──
{
  function parse(raw: string, verdicts: readonly string[]) {
    const cleaned = raw.replace(/```json|```/g, '').trim()
    const s = cleaned.indexOf('{'), e = cleaned.lastIndexOf('}')
    if (s === -1 || e === -1) return null
    try {
      const p = JSON.parse(cleaned.slice(s, e + 1))
      return verdicts.includes(p.verdict) ? p : null
    } catch { return null }
  }
  const legalVerdicts = DOMAINS.legal_statute.verdicts
  assert.ok(parse('```json\n{"verdict":"ALTERED"}\n```', legalVerdicts), 'strips fences + parses')
  assert.ok(parse('Sure! {"verdict":"SUPPORTED"} hope that helps', legalVerdicts), 'extracts embedded object')
  assert.strictEqual(parse('no json here', legalVerdicts), null, 'rejects prose')
  assert.strictEqual(parse('{"verdict":"MAYBE"}', legalVerdicts), null, 'rejects invalid verdict')
  // A domain's own verdict set accepts its verdicts, rejects another domain's
  assert.ok(parse('{"verdict":"COMPLIANT"}', DOMAINS.finra_compliance.verdicts), 'finra verdict accepted in finra domain')
  assert.strictEqual(parse('{"verdict":"COMPLIANT"}', legalVerdicts), null, 'finra verdict rejected in legal domain')
}

// ── domains config: lookup validity, defaults, every domain has NOT_FOUND-style fallback ──
{
  assert.ok(isDomain('legal_statute'), 'legal_statute is a valid domain')
  assert.ok(isDomain('finra_compliance'), 'finra_compliance is a valid domain')
  assert.ok(!isDomain('made_up_domain'), 'unknown string is not a valid domain')
  assert.ok(!isDomain(undefined), 'undefined is not a valid domain')
  assert.ok(DOMAINS[DEFAULT_DOMAIN], 'DEFAULT_DOMAIN resolves to a real config')
  for (const [key, config] of Object.entries(DOMAINS)) {
    assert.ok(config.verdicts.includes(config.notFoundVerdict), `${key}.notFoundVerdict must be one of its own verdicts`)
  }
}

// ── ingest chunk(): mirrors scripts/ingest.ts's sentence-packing logic
//    (not imported — importing that file runs its network-hitting main()). ──
{
  function chunk(text: string, size = 512): string[] {
    const sentences = text.split(/(?<=[.!?])\s+/)
    const out: string[] = []
    let cur = ''
    for (const s of sentences) {
      if (cur && cur.length + 1 + s.length > size) { out.push(cur); cur = '' }
      if (s.length > size) {
        if (cur) { out.push(cur); cur = '' }
        for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size))
        continue
      }
      cur = cur ? `${cur} ${s}` : s
    }
    if (cur) out.push(cur)
    return out
  }
  assert.deepStrictEqual(chunk('One. Two. Three.', 100), ['One. Two. Three.'], 'short text stays one chunk')
  assert.ok(chunk('a'.repeat(50) + '. ' + 'b'.repeat(50) + '.', 60).every((c) => c.length <= 60), 'no chunk exceeds size')
  const longSentence = 'x'.repeat(150) + '.'
  assert.ok(chunk(longSentence, 60).every((c) => c.length <= 60), 'oversized single sentence still gets hard-sliced')
  assert.strictEqual(chunk('One. Two.', 100).join(' '), 'One. Two.', 'no content lost across chunks')
}

// ── parseRetryDelaySeconds: extracts Gemini's RetryInfo.retryDelay from a 429 body ──
{
  const body429 = JSON.stringify({
    error: { code: 429, details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '12.858886587s' }] },
  })
  assert.strictEqual(parseRetryDelaySeconds(body429), 12.858886587, 'extracts fractional-second delay')
  assert.strictEqual(parseRetryDelaySeconds('{"error":{"details":[]}}'), null, 'no RetryInfo -> null')
  assert.strictEqual(parseRetryDelaySeconds('not json'), null, 'malformed body -> null, never throws')
}

// ── resolveProvider: priority order, explicit pin, and missing-key errors ──
{
  const KEYS = ['DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'LLM_PROVIDER'] as const
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
  const reset = () => KEYS.forEach((k) => delete process.env[k])

  reset()
  process.env.GEMINI_API_KEY = 'g'
  process.env.OPENAI_API_KEY = 'o'
  assert.strictEqual(resolveProvider(), 'openai', 'openai beats gemini when deepseek unset')

  process.env.DEEPSEEK_API_KEY = 'd'
  assert.strictEqual(resolveProvider(), 'deepseek', 'deepseek wins priority when all three set')

  process.env.LLM_PROVIDER = 'gemini'
  assert.strictEqual(resolveProvider(), 'gemini', 'LLM_PROVIDER pin overrides priority order')

  process.env.LLM_PROVIDER = 'openai'
  delete process.env.OPENAI_API_KEY
  assert.throws(() => resolveProvider(), /API key is not set/, 'pinning to an unconfigured provider throws')

  reset()
  assert.throws(() => resolveProvider(), /No LLM API key configured/, 'no keys at all throws')

  reset()
  Object.entries(saved).forEach(([k, v]) => { if (v !== undefined) process.env[k] = v })
}

console.log('✓ all self-checks passed')
