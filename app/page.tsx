'use client'
import { useEffect, useState, useCallback } from 'react'
import Script from 'next/script'

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

declare global {
  interface Window { onTurnstileSuccess?: (token: string) => void }
}

type Evidence = { source_name: string; source_url: string; snippet: string; kind: string }
type ClaimResult = {
  claim: string
  truth_score: number | null
  truth_percentage?: number | null
  verdict: string
  what_is_wrong: string | null
  what_is_missing: string | null
  confidence: string
  reference: { source_name: string; source_url: string | null; relevant_excerpt: string | null } | null
  evidence?: Evidence[]
  knowledge_basis?: 'sources' | 'model_knowledge'
}
type ApiResult = {
  overall_score: number | null
  claims: ClaimResult[]
  truncated: boolean
  disclaimer?: string
  evidence_level?: string
  upgrade_hint?: string
  cached?: boolean
  error?: string
}

const VERDICT_COLOR: Record<string, string> = {
  // corpus domains
  SUPPORTED: 'var(--support)',
  ALTERED: 'var(--alter)',
  UNSUPPORTED: 'var(--alter)',
  COMPLIANT: 'var(--support)',
  UNSUBSTANTIATED_CLAIM: 'var(--alter)',
  PROHIBITED_PROMISE: 'var(--alter)',
  MISSING_DISCLOSURE: 'var(--alter)',
  // general domain
  TRUE: 'var(--support)',
  MOSTLY_TRUE: 'var(--support)',
  MISLEADING: 'var(--alter)',
  FALSE: 'var(--alter)',
  UNVERIFIABLE: 'var(--absent)',
  // shared
  NOT_FOUND: 'var(--absent)',
  ERROR: 'var(--absent)',
}

// The demo widget always calls the API anonymously (no key) — see run() below.
// Legal/FINRA are Business-plan-only server-side, so they can never work here;
// listed as locked so visitors discover them instead of hitting a silent 401.
type Mode = { id: string; label: string; placeholder: string; example: string; locked?: boolean }
const MODES: Mode[] = [
  { id: 'general', label: 'General', placeholder: 'Paste any claim, post, or statement in any language…', example: 'Russia is the largest country in the world by land area, and eggs are a type of stone.' },
  { id: 'legal_statute', label: 'Legal', placeholder: 'Paste a legal claim to verify…', example: 'Section 230 gives online platforms complete immunity from every kind of lawsuit, including federal criminal charges.', locked: true },
  { id: 'finra_compliance', label: 'FINRA', placeholder: 'Paste a financial marketing statement to review…', example: 'Our fund guarantees a 12% annual return with absolutely no risk of loss.', locked: true },
]

export default function Landing() {
  const [total, setTotal] = useState<number | null>(null)
  const [text, setText] = useState('')
  const [mode, setMode] = useState<Mode>(MODES[0])
  const [result, setResult] = useState<ApiResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [quota, setQuota] = useState<{ remaining: number; limit: number; reset: number } | null>(null)
  const [err, setErr] = useState('')
  const [turnstileToken, setTurnstileToken] = useState('')

  const loadStats = useCallback(() => {
    fetch('/api/stats').then((r) => r.json()).then((d) => setTotal(d.total_requests)).catch(() => {})
  }, [])

  useEffect(() => {
    loadStats()
    const iv = setInterval(loadStats, 10000)
    return () => clearInterval(iv)
  }, [loadStats])

  useEffect(() => {
    window.onTurnstileSuccess = (token: string) => setTurnstileToken(token)
    return () => { delete window.onTurnstileSuccess }
  }, [])

  async function run() {
    setLoading(true); setErr(''); setResult(null)
    try {
      const res = await fetch('/api/v1/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, domain: mode.id, turnstileToken: turnstileToken || undefined }),
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
      {TURNSTILE_SITE_KEY && (
        <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
      )}
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
          Fact-checking with receipts
        </p>
        <h1 style={{ fontFamily: 'var(--font-display)' }} className="text-4xl md:text-6xl leading-[1.05] font-medium max-w-3xl">
          Paste anything. Get a{' '}
          <span className="italic" style={{ color: 'var(--verdict)' }}>verdict</span>, not a guess.
        </h1>
        <p className="mt-6 text-lg opacity-75 max-w-2xl leading-relaxed">
          Any claim, any language — checked live against the web, news, Wikipedia and professional
          fact-checkers. Every verdict comes with a trust score and the real sources behind it, and
          anything answered without a source is labelled as such. No invented citations, ever.
          Specialized Legal and FINRA-compliance modes for professionals.
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
          <div className="px-6 py-4 border-b flex items-center justify-between gap-4 flex-wrap" style={{ borderColor: 'var(--line)' }}>
            <div className="flex items-center gap-1 rounded-lg p-1" style={{ background: 'var(--ink)' }}>
              {MODES.map((m) => (
                <button
                  key={m.id}
                  onClick={() => { setMode(m); setResult(null); setErr('') }}
                  className="text-xs px-3 py-1.5 rounded-md transition"
                  style={mode.id === m.id
                    ? { background: 'var(--verdict)', color: 'var(--ink)', fontWeight: 500 }
                    : { opacity: 0.6 }}
                >
                  {m.label}{m.locked && ' 🔒'}
                </button>
              ))}
            </div>
            <button onClick={() => setText(mode.example)} className="text-xs opacity-60 hover:opacity-100 transition underline underline-offset-4">
              try an example
            </button>
          </div>

          <div className="p-6">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              maxLength={5000}
              placeholder={mode.placeholder}
              aria-label={`${mode.label} claim to verify`}
              className="w-full bg-transparent resize-none text-lg leading-relaxed placeholder:opacity-40 focus:outline-none"
              style={{ fontFamily: 'var(--font-display)' }}
            />
            {TURNSTILE_SITE_KEY && (
              <div className="cf-turnstile mt-4" data-sitekey={TURNSTILE_SITE_KEY} data-callback="onTurnstileSuccess" />
            )}

            <div className="flex items-center justify-between mt-4">
              <span className="text-xs opacity-40 ledger">{text.length}/5000</span>
              {mode.locked ? (
                <a href="/login"
                   className="px-5 py-2.5 rounded-lg font-medium text-[var(--ink)] transition"
                   style={{ background: 'var(--verdict)' }}>
                  Get Business plan to unlock {mode.label} →
                </a>
              ) : (
                <button
                  onClick={run}
                  disabled={loading || text.trim().length < 10 || (!!TURNSTILE_SITE_KEY && !turnstileToken)}
                  className="px-5 py-2.5 rounded-lg font-medium text-[var(--ink)] disabled:opacity-30 transition"
                  style={{ background: 'var(--verdict)' }}
                >
                  {loading ? 'Examining…' : 'Render verdict'}
                </button>
              )}
            </div>

            {/* Upfront about the free limits — no surprises when a cap is hit. */}
            <p className="mt-3 text-xs opacity-40 leading-relaxed">
              Free demo: 5 checks/hour, and a shared daily limit across all visitors — it can run out on busy days.
              No signup. <a href="/login" className="underline underline-offset-2 hover:opacity-100">Get a free API key</a> for
              1,000/hour and the Legal &amp; FINRA modes.
            </p>

            {err && <p className="mt-4 text-sm" style={{ color: 'var(--alter)' }}>{err}</p>}

            {result && (
              <div className="mt-8 space-y-6">
                <p className="text-xs opacity-60 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--line)' }}>
                  AI-generated and informational only — not legal, financial, or compliance advice. Verify independently.
                  {result.cached && <span className="ml-1 opacity-70">· served from cache</span>}
                </p>
                {result.upgrade_hint && (
                  <a href="/login" className="block text-sm rounded-lg border px-4 py-3 transition hover:opacity-90"
                     style={{ borderColor: 'var(--verdict-dim)' }}>
                    <span style={{ color: 'var(--verdict)' }}>Same verdicts, more of them.</span>{' '}
                    {result.upgrade_hint} →
                  </a>
                )}
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
  -H "x-api-key: tl_••••"        # omit for the free tier (general only) \\
  -d '{"text": "Russia is the largest country in the world.",
       "domain": "general"}'   # legal_statute & finra_compliance need a Business-plan key`}
        </pre>
      </section>

      {/* Pricing */}
      <section id="pricing" className="px-6 md:px-10 py-16 border-t max-w-5xl mx-auto" style={{ borderColor: 'var(--line)' }}>
        <h2 style={{ fontFamily: 'var(--font-display)' }} className="text-3xl font-medium mb-8">Pricing</h2>
        <div className="grid md:grid-cols-3 gap-5">
          <Tier name="Free" price="$0" lines={['5 general checks / hour', 'No key, no sign-up', 'Full web, news & fact-check evidence', 'The same verdicts Pro returns', 'A shared daily cap applies']} cta="Use it above" href="#api" muted />
          <Tier name="Pro" price="$29/mo" lines={['1,000 requests / hour', 'Programmatic API access', 'General fact-checking', 'Dashboard & saved history']} cta="Get started" href="/login" />
          <Tier name="Business" price="$149/mo" lines={['Everything in Pro', 'Legal statute domain', 'FINRA/SEC compliance domain', 'Built for professional use']} cta="Get started" href="/login" />
        </div>
      </section>

      <footer className="px-6 md:px-10 py-10 border-t text-sm opacity-50 flex flex-wrap items-center gap-x-4 gap-y-2" style={{ borderColor: 'var(--line)' }}>
        <span>TruthLens — verdicts are AI-generated and informational only, not legal, financial, or compliance advice.</span>
        <a href="/privacy" className="underline underline-offset-4 hover:opacity-100">Privacy</a>
        <a href="/terms" className="underline underline-offset-4 hover:opacity-100">Terms</a>
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
      {c.knowledge_basis === 'model_knowledge' && (
        <p className="text-xs rounded-md px-3 py-2 mb-3" style={{ border: '1px solid var(--alter)', color: 'var(--alter)' }}>
          From the model&apos;s own knowledge — no source was retrieved for this claim. Treat as a lead to verify, not a cited fact.
        </p>
      )}
      {c.what_is_wrong && <Field label="What's wrong" body={c.what_is_wrong} />}
      {c.what_is_missing && <Field label="What's missing" body={c.what_is_missing} />}
      {c.reference?.source_url && (
        <a href={c.reference.source_url} target="_blank" rel="noopener noreferrer"
           className="inline-block mt-2 text-sm underline underline-offset-4" style={{ color: 'var(--verdict)' }}>
          {c.reference.source_name || 'Source'} ↗
        </a>
      )}
      {c.evidence && c.evidence.length > 0 && (
        <div className="mt-4 pt-3 border-t" style={{ borderColor: 'var(--line)' }}>
          <p className="text-xs uppercase tracking-wider opacity-40 mb-2">Sources checked</p>
          <ul className="space-y-1.5">
            {c.evidence.map((e, i) => (
              <li key={i} className="text-sm flex items-start gap-2">
                <span className="text-xs px-1.5 py-0.5 rounded shrink-0 opacity-60" style={{ border: '1px solid var(--line)' }}>{e.kind}</span>
                <a href={e.source_url} target="_blank" rel="noopener noreferrer"
                   className="underline underline-offset-4 opacity-80 hover:opacity-100" style={{ color: 'var(--verdict)' }}>
                  {e.source_name}
                </a>
              </li>
            ))}
          </ul>
        </div>
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
