// One runnable check per piece of non-trivial logic. No framework.
// Run: npm run check   (does NOT need network or DB — pure logic only)
import assert from 'node:assert'
import { generateKey, hashKey, clientIp } from '../lib/keys'
import { resolveProvider, parseRetryDelaySeconds, isRetryableStatus } from '../lib/llm'
import { verifyTurnstileToken } from '../lib/turnstile'
import { DOMAINS, DEFAULT_DOMAIN, isDomain } from '../lib/domains'
import { dedupeAndCap, stripHtml, newsQuery, type Evidence } from '../lib/evidence'
import { geminiKeys } from '../lib/llm'
import { parseExtractedClaims } from '../lib/pipeline'

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
  assert.ok(isDomain('general'), 'general is a valid domain')
  for (const [key, config] of Object.entries(DOMAINS)) {
    assert.ok(config.verdicts.includes(config.notFoundVerdict), `${key}.notFoundVerdict must be one of its own verdicts`)
    assert.ok(config.evidence === 'corpus' || config.evidence === 'web', `${key}.evidence must be corpus|web`)
  }
  assert.strictEqual(DOMAINS.general.evidence, 'web', 'general uses web evidence')
  assert.strictEqual(DOMAINS.legal_statute.evidence, 'corpus', 'legal_statute uses corpus evidence')
}

// ── evidence dedupeAndCap: fact-checks rank first, URL dedupe, hard cap ──
{
  const ev = (kind: Evidence['kind'], url: string): Evidence => ({ source_name: url, source_url: url, snippet: 's', kind })
  const items: Evidence[] = [
    ev('web', 'https://a.com'),
    ev('factcheck', 'https://b.com'),
    ev('wiki', 'https://a.com'),      // dup URL of the web item
    ev('news', 'https://c.com'),
  ]
  const out = dedupeAndCap(items, 10)
  assert.strictEqual(out[0].kind, 'factcheck', 'factcheck sorts to the front')
  assert.strictEqual(out.length, 3, 'duplicate URL is dropped')
  assert.deepStrictEqual(out.map((e) => e.source_url).sort(), ['https://a.com', 'https://b.com', 'https://c.com'], 'one entry per URL')

  const many: Evidence[] = Array.from({ length: 20 }, (_, i) => ev('web', `https://x${i}.com`))
  assert.strictEqual(dedupeAndCap(many, 10).length, 10, 'caps at the requested limit')

  // Per-kind cap: Wikipedia's keyword search answers news queries with
  // tangential list-articles, and since wiki outranks news/web it was crowding
  // real reporting out of the pool entirely.
  const wikiHeavy: Evidence[] = [
    ...Array.from({ length: 6 }, (_, i) => ev('wiki', `https://w${i}.org`)),
    ...Array.from({ length: 4 }, (_, i) => ev('news', `https://n${i}.com`)),
  ]
  const capped = dedupeAndCap(wikiHeavy, 10, { wiki: 3 })
  assert.strictEqual(capped.filter((e) => e.kind === 'wiki').length, 3, 'wiki is limited by the per-kind cap')
  assert.strictEqual(capped.filter((e) => e.kind === 'news').length, 4, 'news survives instead of being crowded out')
  // Kinds without a cap are unaffected.
  assert.strictEqual(dedupeAndCap(wikiHeavy, 10).filter((e) => e.kind === 'wiki').length, 6, 'no cap given -> unchanged')
}

// ── stripHtml: removes tags + entities, collapses whitespace ──
{
  assert.strictEqual(stripHtml('<b>hi</b>&nbsp;there'), 'hi there', 'strips tags and entities')
  assert.strictEqual(stripHtml('a   b\n\nc'), 'a b c', 'collapses whitespace')
}

// ── newsQuery: GNews ANDs every term, so long natural-language queries match
//    nothing. Must reduce to a few topical keywords, preferring proper nouns. ──
{
  // The real failing case: this full query returned 0 GNews articles.
  assert.strictEqual(
    newsQuery('Sri Lanka recently signed a new IMF loan agreement'),
    'Sri Lanka IMF',
    'keeps proper nouns, drops stopwords/filler that killed the match'
  )
  assert.strictEqual(
    newsQuery('Donald Trump is the current president of the United States'),
    'Donald Trump United States',
    'caps at 4 proper nouns'
  )
  // No proper nouns -> fall back to significant words, still capped.
  assert.strictEqual(
    newsQuery('vaccines cause autism in children'),
    'vaccines cause autism children',
    'falls back to significant words when there are no proper nouns'
  )
  assert.ok(newsQuery('a b c').split(' ').length <= 4, 'never exceeds the word cap')
  assert.strictEqual(newsQuery('the of and'), '', 'all-stopword query yields empty (caller skips)')
}

// ── domain policy: only consumer general-purpose checking may answer from the
//    model's own memory. Legal/compliance verdicts must stay strictly cited —
//    a professional acting on a remembered statute is the exact failure this
//    product exists to prevent. ──
{
  assert.strictEqual(DOMAINS.general.allowModelKnowledge, true, 'general may fall back to model knowledge')
  assert.strictEqual(DOMAINS.legal_statute.allowModelKnowledge, false, 'legal must never answer from memory')
  assert.strictEqual(DOMAINS.finra_compliance.allowModelKnowledge, false, 'compliance must never answer from memory')
  // Any domain that forbids model knowledge must be corpus-backed.
  for (const [key, c] of Object.entries(DOMAINS)) {
    if (!c.allowModelKnowledge) {
      assert.strictEqual(c.evidence, 'corpus', `${key} forbids model knowledge so it must be corpus-grounded`)
    }
  }
}

// ── model-knowledge guard: memory may SUPPORT a claim but must never REFUTE
//    one. A model asked about an unfamiliar local news event will answer "no
//    such incident occurred" — it did exactly that for a real Sri Lankan
//    murder case. Mirrors the guard in verifyFromKnowledge(). ──
{
  const NOT_FOUND = DOMAINS.general.notFoundVerdict
  const guard = (verdict: string, score: number | null, confidence: string) => ({
    verdict: verdict === 'FALSE' ? NOT_FOUND : verdict,
    truth_score: verdict === 'FALSE' ? null : score,
    confidence: confidence === 'HIGH' ? 'MEDIUM' : confidence,
    reference: null,
  })

  assert.strictEqual(guard('FALSE', 0, 'HIGH').verdict, NOT_FOUND, 'memory can never refute a claim')
  assert.strictEqual(guard('FALSE', 0, 'HIGH').truth_score, null, 'a refuted-from-memory score is dropped too')
  assert.strictEqual(guard('TRUE', 1, 'HIGH').verdict, 'TRUE', 'memory may still support a claim')
  assert.strictEqual(guard('TRUE', 1, 'HIGH').confidence, 'MEDIUM', 'unretrieved knowledge never claims HIGH confidence')
  assert.strictEqual(guard('MOSTLY_TRUE', 0.9, 'LOW').confidence, 'LOW', 'lower confidences pass through')
  assert.strictEqual(guard('TRUE', 1, 'MEDIUM').reference, null, 'memory never carries a citation')
}

// ── geminiKeys: rotation list is ordered, skips blanks, dedupes nothing (a
//    repeated key is the caller's choice) — used to survive daily quota caps. ──
{
  const KEYS = ['GEMINI_API_KEY', 'GEMINI_API_KEY_2', 'GEMINI_API_KEY_3'] as const
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
  KEYS.forEach((k) => delete process.env[k])

  assert.deepStrictEqual(geminiKeys(), [], 'no keys configured -> empty list')

  process.env.GEMINI_API_KEY = 'a'
  process.env.GEMINI_API_KEY_3 = 'c'
  assert.deepStrictEqual(geminiKeys(), ['a', 'c'], 'skips the unset middle slot, preserves order')

  process.env.GEMINI_API_KEY_2 = '   '
  assert.deepStrictEqual(geminiKeys(), ['a', 'c'], 'blank/whitespace key is ignored')

  KEYS.forEach((k) => delete process.env[k])
  Object.entries(saved).forEach(([k, v]) => { if (v !== undefined) process.env[k] = v })
}

// ── cache-write guard: a run containing ERROR verdicts must never be persisted.
//    Caching an internal/provider failure replays that outage to every user
//    asking the same question for the whole TTL (this happened in production).
//    Mirrors the predicate in app/api/v1/check/route.ts. ──
{
  const shouldCache = (claims: { verdict: string }[]) => !claims.some((c) => c.verdict === 'ERROR')

  assert.strictEqual(shouldCache([{ verdict: 'TRUE' }, { verdict: 'FALSE' }]), true, 'real verdicts are cacheable')
  assert.strictEqual(shouldCache([{ verdict: 'UNVERIFIABLE' }]), true, 'UNVERIFIABLE is a real answer, cacheable')
  assert.strictEqual(shouldCache([{ verdict: 'ERROR' }]), false, 'a failed run is never cached')
  assert.strictEqual(shouldCache([{ verdict: 'TRUE' }, { verdict: 'ERROR' }]), false, 'one ERROR poisons the whole response')
  assert.strictEqual(shouldCache([]), true, 'no claims -> nothing to poison')
}

// ── parseExtractedClaims: parses JSON array, defaults query, falls back to sentences ──
{
  const ok = parseExtractedClaims('```json\n[{"claim":"Eggs are stones","search_query":"are eggs stones"}]\n```', 'orig')
  assert.strictEqual(ok.length, 1, 'parses one claim')
  assert.strictEqual(ok[0].search_query, 'are eggs stones', 'keeps provided search query')

  const noQuery = parseExtractedClaims('[{"claim":"Sky is blue"}]', 'orig')
  assert.strictEqual(noQuery[0].search_query, 'Sky is blue', 'defaults query to the claim text')

  const fallback = parseExtractedClaims('not json at all', 'Russia is the largest country in the world. Eggs are stones.')
  assert.ok(fallback.length >= 1, 'falls back to sentence split on unparseable output')
  assert.strictEqual(fallback[0].claim, fallback[0].search_query, 'fallback query mirrors the sentence')

  assert.deepStrictEqual(parseExtractedClaims('[]', 'orig short'), [], 'empty array yields no claims when text too short to split')
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

// ── isRetryableStatus: 429/503 retry, everything else doesn't ──
{
  assert.ok(isRetryableStatus(429), '429 is retryable')
  assert.ok(isRetryableStatus(503), '503 is retryable')
  assert.ok(!isRetryableStatus(400), '400 is not retryable')
  assert.ok(!isRetryableStatus(401), '401 is not retryable')
  assert.ok(!isRetryableStatus(500), '500 is not retryable')
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

// ── verifyTurnstileToken: inert when unconfigured, requires a token once secret is set ──
async function checkTurnstile() {
  const saved = process.env.TURNSTILE_SECRET_KEY
  delete process.env.TURNSTILE_SECRET_KEY
  assert.strictEqual(await verifyTurnstileToken(undefined, '1.2.3.4'), true, 'no secret configured -> always passes')
  assert.strictEqual(await verifyTurnstileToken('some-token', '1.2.3.4'), true, 'no secret configured -> passes even with a token')

  process.env.TURNSTILE_SECRET_KEY = 'test-secret'
  assert.strictEqual(await verifyTurnstileToken(undefined, '1.2.3.4'), false, 'secret configured, no token -> fails without a network call')

  if (saved !== undefined) process.env.TURNSTILE_SECRET_KEY = saved
  else delete process.env.TURNSTILE_SECRET_KEY
}

checkTurnstile()
  .then(() => console.log('✓ all self-checks passed'))
  .catch((e) => { console.error(e); process.exit(1) })
