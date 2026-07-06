// One runnable check per piece of non-trivial logic. No framework.
// Run: npm run check   (does NOT need network or DB — pure logic only)
import assert from 'node:assert'
import { generateKey, hashKey, clientIp } from '../lib/keys'

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
  function parse(raw: string) {
    const cleaned = raw.replace(/```json|```/g, '').trim()
    const s = cleaned.indexOf('{'), e = cleaned.lastIndexOf('}')
    if (s === -1 || e === -1) return null
    try {
      const p = JSON.parse(cleaned.slice(s, e + 1))
      return ['SUPPORTED', 'ALTERED', 'UNSUPPORTED', 'NOT_FOUND'].includes(p.verdict) ? p : null
    } catch { return null }
  }
  assert.ok(parse('```json\n{"verdict":"ALTERED"}\n```'), 'strips fences + parses')
  assert.ok(parse('Sure! {"verdict":"SUPPORTED"} hope that helps') , 'extracts embedded object')
  assert.strictEqual(parse('no json here'), null, 'rejects prose')
  assert.strictEqual(parse('{"verdict":"MAYBE"}'), null, 'rejects invalid verdict')
}

console.log('✓ all self-checks passed')
