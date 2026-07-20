'use client'
import { useEffect, useState, useCallback } from 'react'
import { getBrowserClient } from '@/lib/supabase-browser'

type Key = { id: string; key_prefix: string; tier: string; created_at: string; last_used_at: string | null }
type Usage = { period: string; total_requests: number; total_claims: number; total_llm_calls: number }
type Check = {
  id: string
  domain: string
  input_text: string
  overall_score: number | null
  response: { evidence_level?: string } | null
  created_at: string
}

export default function DashboardClient() {
  const [keys, setKeys] = useState<Key[]>([])
  const [usage, setUsage] = useState<Usage[]>([])
  const [history, setHistory] = useState<Check[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [newKey, setNewKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    const [k, u, h] = await Promise.all([
      fetch('/api/keys').then((r) => r.json()),
      fetch('/api/usage').then((r) => r.json()),
      fetch('/api/history').then((r) => r.json()).catch(() => ({ checks: [] })),
    ])
    setKeys(Array.isArray(k) ? k : [])
    setUsage(Array.isArray(u) ? u : [])
    setHistory(Array.isArray(h?.checks) ? h.checks : [])
  }, [])

  useEffect(() => { load() }, [load])

  async function createKey() {
    setBusy(true)
    const res = await fetch('/api/keys', { method: 'POST' })
    const data = await res.json()
    if (res.ok) setNewKey(data.key)
    setBusy(false)
    load()
  }

  async function revoke(id: string) {
    await fetch('/api/keys', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setNewKey(null)
    load()
  }

  function copy(t: string) {
    navigator.clipboard.writeText(t)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  async function signOut() {
    await getBrowserClient().auth.signOut()
    location.href = '/'
  }

  return (
    <main className="min-h-screen">
      <nav className="flex items-center justify-between px-6 md:px-10 py-5 border-b" style={{ borderColor: 'var(--line)' }}>
        <a href="/" style={{ fontFamily: 'var(--font-display)' }} className="text-xl font-semibold">TruthLens</a>
        <button onClick={signOut} className="text-sm opacity-60 hover:opacity-100 transition">Sign out</button>
      </nav>

      <div className="max-w-3xl mx-auto px-6 py-12 space-y-8">
        <h1 style={{ fontFamily: 'var(--font-display)' }} className="text-3xl">Dashboard</h1>

        {/* Newly created key — shown once */}
        {newKey && (
          <div className="rounded-xl border p-5" style={{ borderColor: 'var(--verdict-dim)' }}>
            <p className="text-sm mb-2" style={{ color: 'var(--verdict)' }}>
              Copy this key now — it won't be shown again.
            </p>
            <div className="flex items-center gap-3">
              <code className="flex-1 text-sm truncate" style={{ fontFamily: 'var(--font-mono)' }}>{newKey}</code>
              <button onClick={() => copy(newKey)} className="text-xs px-3 py-1.5 rounded-md border transition" style={{ borderColor: 'var(--line)' }}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        {/* Keys */}
        <section className="rounded-2xl border p-6" style={{ borderColor: 'var(--line)', background: 'var(--paper)' }}>
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="font-medium">API key</h2>
              <p className="text-sm opacity-50">Pro tier — 1,000 requests / hour</p>
            </div>
            {!keys.length && (
              <button onClick={createKey} disabled={busy}
                className="px-4 py-2 rounded-lg text-sm font-medium text-[var(--ink)] disabled:opacity-40 transition"
                style={{ background: 'var(--verdict)' }}>
                {busy ? 'Generating…' : 'Generate key'}
              </button>
            )}
          </div>

          {keys.length ? keys.map((k) => (
            <div key={k.id} className="rounded-lg border p-4 flex items-center justify-between" style={{ borderColor: 'var(--line)' }}>
              <div>
                <code className="text-sm" style={{ fontFamily: 'var(--font-mono)' }}>{k.key_prefix}••••</code>
                <p className="text-xs opacity-40 mt-1">
                  created {new Date(k.created_at).toLocaleDateString()}
                  {k.last_used_at && ` · last used ${new Date(k.last_used_at).toLocaleDateString()}`}
                </p>
              </div>
              <button onClick={() => revoke(k.id)} className="text-xs transition" style={{ color: 'var(--alter)' }}>Revoke</button>
            </div>
          )) : <p className="text-sm opacity-50">No active key. Generate one to start.</p>}
        </section>

        {/* Usage / billing */}
        <section className="rounded-2xl border p-6" style={{ borderColor: 'var(--line)', background: 'var(--paper)' }}>
          <h2 className="font-medium mb-1">Usage</h2>
          <p className="text-sm opacity-50 mb-5">Monthly totals. LLM calls are the billable unit.</p>
          {usage.length ? (
            <table className="w-full text-sm ledger">
              <thead>
                <tr className="opacity-50 text-left text-xs uppercase tracking-wider">
                  <th className="pb-2 font-normal">Month</th>
                  <th className="pb-2 font-normal text-right">Requests</th>
                  <th className="pb-2 font-normal text-right">Claims</th>
                  <th className="pb-2 font-normal text-right">LLM calls</th>
                </tr>
              </thead>
              <tbody style={{ fontFamily: 'var(--font-mono)' }}>
                {usage.map((u) => (
                  <tr key={u.period} className="border-t" style={{ borderColor: 'var(--line)' }}>
                    <td className="py-2.5">{new Date(u.period).toLocaleDateString(undefined, { year: 'numeric', month: 'short' })}</td>
                    <td className="py-2.5 text-right">{u.total_requests}</td>
                    <td className="py-2.5 text-right">{u.total_claims}</td>
                    <td className="py-2.5 text-right" style={{ color: 'var(--verdict)' }}>{u.total_llm_calls}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-sm opacity-50">No usage yet.</p>}
        </section>

        {/* Check history */}
        <section className="rounded-2xl border p-6" style={{ borderColor: 'var(--line)', background: 'var(--paper)' }}>
          <h2 className="font-medium mb-1">History</h2>
          <p className="text-sm opacity-50 mb-5">Your recent checks. Click one to see the full result.</p>
          {history.length ? (
            <div className="space-y-2">
              {history.map((c) => {
                const pct = c.overall_score === null ? null : Math.round(c.overall_score * 100)
                const open = expanded === c.id
                return (
                  <div key={c.id} className="rounded-lg border" style={{ borderColor: 'var(--line)' }}>
                    <button
                      onClick={() => setExpanded(open ? null : c.id)}
                      className="w-full text-left p-4 flex items-start justify-between gap-4"
                    >
                      <div className="min-w-0">
                        <p className="text-sm truncate">{c.input_text}</p>
                        <p className="text-xs opacity-40 mt-1">
                          {c.domain} · {new Date(c.created_at).toLocaleString()}
                        </p>
                      </div>
                      {pct !== null && (
                        <span className="text-sm shrink-0 ledger" style={{ fontFamily: 'var(--font-mono)', color: 'var(--verdict)' }}>
                          {pct}%
                        </span>
                      )}
                    </button>
                    {open && (
                      <pre className="text-xs overflow-auto border-t p-4 leading-relaxed" style={{ borderColor: 'var(--line)', fontFamily: 'var(--font-mono)' }}>
                        {JSON.stringify(c.response, null, 2)}
                      </pre>
                    )}
                  </div>
                )
              })}
            </div>
          ) : <p className="text-sm opacity-50">No checks yet.</p>}
        </section>
      </div>
    </main>
  )
}
