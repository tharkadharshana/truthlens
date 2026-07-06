'use client'
import { useEffect, useState, useCallback } from 'react'

type ClaimResult = {
  claim: string
  truth_score: number | null
  verdict: string
  what_is_wrong: string | null
  what_is_missing: string | null
  confidence: string
  reference: { source_name: string; source_url: string | null; relevant_excerpt: string | null } | null
}
type ApiResult = { overall_score: number | null; claims: ClaimResult[]; truncated: boolean; error?: string }

const VERDICT_COLOR: Record<string, string> = {
  SUPPORTED: 'var(--support)',
  ALTERED: 'var(--alter)',
  UNSUPPORTED: 'var(--alter)',
  NOT_FOUND: 'var(--absent)',
  ERROR: 'var(--absent)',
}

const EXAMPLE = 'Section 230 gives online platforms complete immunity from every kind of lawsuit, including federal criminal charges.'

export default function Landing() {
  const [total, setTotal] = useState<number | null>(null)
  const [text, setText] = useState('')
  const [result, setResult] = useState<ApiResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [quota, setQuota] = useState<{ remaining: number; limit: number; reset: number } | null>(null)
  const [err, setErr] = useState('')

  const loadStats = useCallback(() => {
    fetch('/api/stats').then((r) => r.json()).then((d) => setTotal(d.total_requests)).catch(() => {})
  }, [])

  useEffect(() => {
    loadStats()
    const iv = setInterval(loadStats, 10000)
    return () => clearInterval(iv)
  }, [loadStats])

  async function run() {
    setLoading(true); setErr(''); setResult(null)
    try {
      const res = await fetch('/api/v1/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      setQuota({
        remaining: Number(res.headers.get('X-RateLimit-Remaining') ?? 0),
        limit: Number(res.headers.get('X-RateLimit-Limit') ?? 10),
        reset: Number(res.headers.get('X-RateLimit-Reset') ?? 0),
      })
      const data: ApiResult = await res.json()
      if (!res.ok) { setErr(data.error || 'Request failed'); }
      else { setResult(data); loadStats() }
    } catch {
      setErr('Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen">
      {/* Top bar */}
      <nav className="flex items-center justify-between px-6 md:px-10 py-5 border-b" style={{ borderColor: 'var(--line)' }}>
        <span style={{ fontFamily: 'var(--font-display)' }} className="text-xl font-semibold tracking-tight">
          TruthLens
        </span>
        <div className="flex items-center gap-6 text-sm">
          <a href="#api" className="opacity-70 hover:opacity-100 transition">API</a>
          <a href="#pricing" className="opacity-70 hover:opacity-100 transition">Pricing</a>
          <a href="/login" className="px-3 py-1.5 rounded-md text-[var(--ink)] font-medium" style={{ background: 'var(--verdict)' }}>
            Get a key
          </a>
        </div>
      </nav>

      {/* Hero */}
      <section className="px-6 md:px-10 pt-16 md:pt-24 pb-12 max-w-5xl mx-auto">
        <p className="text-sm uppercase tracking-[0.2em] mb-5" style={{ color: 'var(--verdict)' }}>
          Legal claim verification
        </p>
        <h1 style={{ fontFamily: 'var(--font-display)' }} className="text-4xl md:text-6xl leading-[1.05] font-medium max-w-3xl">
          Every legal claim deserves a{' '}
          <span className="italic" style={{ color: 'var(--verdict)' }}>verdict</span>, not a guess.
        </h1>
        <p className="mt-6 text-lg opacity-75 max-w-2xl leading-relaxed">
          Send a statement. Get a structured verdict scored against real statutes and case law —
          with the exact citation, what was altered, and what was left out. No invented sources.
        </p>

        {/* Dual counters */}
        <div className="grid grid-cols-2 gap-4 mt-10 max-w-xl">
          <Counter
            label="Claims verified, all time"
            value={total === null ? '—' : total.toLocaleString()}
            accent="var(--verdict)"
          />
          <Counter
            label="Your free quota"
            value={quota ? `${quota.remaining}/${quota.limit}` : '10/10'}
            accent="var(--support)"
            sub={quota ? `resets ${new Date(quota.reset).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'no key needed'}
          />
        </div>
      </section>

      {/* Live demo */}
      <section className="px-6 md:px-10 pb-20 max-w-5xl mx-auto">
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--line)', background: 'var(--paper)' }}>
          <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--line)' }}>
            <span className="text-sm opacity-60" style={{ fontFamily: 'var(--font-mono)' }}>POST /api/v1/check</span>
            <button onClick={() => setText(EXAMPLE)} className="text-xs opacity-60 hover:opacity-100 transition underline underline-offset-4">
              try an example
            </button>
          </div>

          <div className="p-6">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              maxLength={5000}
              placeholder="Paste a legal claim to verify…"
              aria-label="Legal claim to verify"
              className="w-full bg-transparent resize-none text-lg leading-relaxed placeholder:opacity-40 focus:outline-none"
              style={{ fontFamily: 'var(--font-display)' }}
            />
            <div className="flex items-center justify-between mt-4">
              <span className="text-xs opacity-40 ledger">{text.length}/5000</span>
              <button
                onClick={run}
                disabled={loading || text.trim().length < 10}
                className="px-5 py-2.5 rounded-lg font-medium text-[var(--ink)] disabled:opacity-30 transition"
                style={{ background: 'var(--verdict)' }}
              >
                {loading ? 'Examining…' : 'Render verdict'}
              </button>
            </div>

            {err && <p className="mt-4 text-sm" style={{ color: 'var(--alter)' }}>{err}</p>}

            {result && (
              <div className="mt-8 space-y-6">
                {result.overall_score !== null && (
                  <OverallSeal score={result.overall_score} />
                )}
                {result.truncated && (
                  <p className="text-xs opacity-50">Only the first 8 claims were verified. Split long documents for full coverage.</p>
                )}
                {result.claims.map((c, i) => <ClaimCard key={i} c={c} />)}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* API */}
      <section id="api" className="px-6 md:px-10 py-16 border-t max-w-5xl mx-auto" style={{ borderColor: 'var(--line)' }}>
        <h2 style={{ fontFamily: 'var(--font-display)' }} className="text-3xl font-medium mb-6">One endpoint.</h2>
        <pre className="rounded-xl border p-6 text-sm overflow-auto leading-relaxed" style={{ borderColor: 'var(--line)', background: 'var(--paper)', fontFamily: 'var(--font-mono)' }}>
{`curl -X POST https://YOUR_DOMAIN/api/v1/check \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: tl_••••"        # omit for the free tier \\
  -d '{"text": "Section 230 gives platforms total immunity."}'`}
        </pre>
      </section>

      {/* Pricing */}
      <section id="pricing" className="px-6 md:px-10 py-16 border-t max-w-5xl mx-auto" style={{ borderColor: 'var(--line)' }}>
        <h2 style={{ fontFamily: 'var(--font-display)' }} className="text-3xl font-medium mb-8">Pricing</h2>
        <div className="grid md:grid-cols-2 gap-5">
          <Tier name="Free" price="$0" lines={['10 requests / hour', 'No key, no sign-up', 'Full structured verdicts', 'Real citations']} cta="Use it above" href="#api" muted />
          <Tier name="Pro" price="Free in beta" lines={['1,000 requests / hour', 'API key + usage dashboard', 'Per-month billing logs', 'Priority pipeline']} cta="Get a key" href="/login" />
        </div>
      </section>

      <footer className="px-6 md:px-10 py-10 border-t text-sm opacity-50" style={{ borderColor: 'var(--line)' }}>
        TruthLens — verdicts are model-assisted and informational, not legal advice.
      </footer>
    </main>
  )
}

function Counter({ label, value, accent, sub }: { label: string; value: string; accent: string; sub?: string }) {
  return (
    <div className="rounded-xl border px-5 py-4" style={{ borderColor: 'var(--line)', background: 'var(--paper)' }}>
      <p className="text-xs uppercase tracking-wider opacity-50 mb-2">{label}</p>
      <p className="text-3xl font-medium ledger" style={{ color: accent, fontFamily: 'var(--font-mono)' }}>{value}</p>
      {sub && <p className="text-xs opacity-40 mt-1">{sub}</p>}
    </div>
  )
}

function OverallSeal({ score }: { score: number }) {
  const pct = Math.round(score * 100)
  const color = score >= 0.7 ? 'var(--support)' : score >= 0.4 ? 'var(--alter)' : 'var(--alter)'
  return (
    <div className="flex items-center gap-4">
      <div className="relative w-20 h-20 rounded-full border-2 flex items-center justify-center ledger" style={{ borderColor: color }}>
        <span className="text-xl font-semibold" style={{ color, fontFamily: 'var(--font-mono)' }}>{pct}</span>
      </div>
      <div>
        <p className="text-xs uppercase tracking-wider opacity-50">Overall truthfulness</p>
        <p style={{ fontFamily: 'var(--font-display)' }} className="text-2xl">{pct}% supported</p>
      </div>
    </div>
  )
}

function ClaimCard({ c }: { c: ClaimResult }) {
  const color = VERDICT_COLOR[c.verdict] ?? 'var(--absent)'
  return (
    <div className="rounded-xl border p-5" style={{ borderColor: 'var(--line)' }}>
      <div className="flex items-start justify-between gap-4 mb-3">
        <p style={{ fontFamily: 'var(--font-display)' }} className="text-lg leading-snug flex-1">{c.claim}</p>
        <span className="text-xs font-medium px-2.5 py-1 rounded-md whitespace-nowrap" style={{ color, border: `1px solid ${color}` }}>
          {c.verdict}
        </span>
      </div>
      <div className="flex items-center gap-3 mb-3 text-xs opacity-60">
        {c.truth_score !== null && <span className="ledger">score {Math.round(c.truth_score * 100)}%</span>}
        <span>confidence {c.confidence.toLowerCase()}</span>
      </div>
      {c.what_is_wrong && <Field label="What's wrong" body={c.what_is_wrong} />}
      {c.what_is_missing && <Field label="What's missing" body={c.what_is_missing} />}
      {c.reference?.source_url && (
        <a href={c.reference.source_url} target="_blank" rel="noopener noreferrer"
           className="inline-block mt-2 text-sm underline underline-offset-4" style={{ color: 'var(--verdict)' }}>
          {c.reference.source_name || 'Source'} ↗
        </a>
      )}
    </div>
  )
}

function Field({ label, body }: { label: string; body: string }) {
  return (
    <div className="mb-2">
      <p className="text-xs uppercase tracking-wider opacity-40">{label}</p>
      <p className="text-sm opacity-85 leading-relaxed">{body}</p>
    </div>
  )
}

function Tier({ name, price, lines, cta, href, muted }: { name: string; price: string; lines: string[]; cta: string; href: string; muted?: boolean }) {
  return (
    <div className="rounded-2xl border p-7" style={{ borderColor: muted ? 'var(--line)' : 'var(--verdict-dim)', background: 'var(--paper)' }}>
      <p className="text-lg font-medium">{name}</p>
      <p style={{ fontFamily: 'var(--font-display)' }} className="text-3xl my-3" >{price}</p>
      <ul className="space-y-2 text-sm opacity-80 my-6">
        {lines.map((l) => <li key={l}>— {l}</li>)}
      </ul>
      <a href={href} className="block text-center py-2.5 rounded-lg font-medium transition"
         style={muted ? { border: '1px solid var(--line)' } : { background: 'var(--verdict)', color: 'var(--ink)' }}>
        {cta}
      </a>
    </div>
  )
}
