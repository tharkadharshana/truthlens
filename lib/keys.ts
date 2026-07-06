import { createHash, randomBytes } from 'crypto'
import type { NextRequest } from 'next/server'

// ── API key hashing ─────────────────────────────────────────────────
// Fix vs v1: keys were stored plaintext. Now we store sha256(raw) and only
// ever show the raw key once, at creation. Lookup is by hash.

export function generateKey(): { raw: string; hash: string; prefix: string } {
  const raw = 'tl_' + randomBytes(24).toString('hex')   // 48 hex chars
  const hash = hashKey(raw)
  const prefix = raw.slice(0, 11)                        // 'tl_' + 8 chars for display
  return { raw, hash, prefix }
}

export function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

// ── Client IP ────────────────────────────────────────────────────────
// Fix vs v1: x-forwarded-for was used raw (spoofable, and missing header
// collapsed every anon user into one bucket). On Vercel the FIRST IP in
// x-forwarded-for is the real client; the platform appends, it can't be
// trusted-spoofed past Vercel's own injected value. We also fall back to a
// per-request random so a missing header can't share a global bucket.
// ponytail: trusts Vercel's x-forwarded-for. Ceiling: behind a different
// proxy this needs adjusting. Upgrade: read a platform-verified header.
export function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  const real = req.headers.get('x-real-ip')
  if (real) return real.trim()
  // No header — do NOT collapse into a shared 'anon' bucket.
  return 'noip:' + randomBytes(8).toString('hex')
}
