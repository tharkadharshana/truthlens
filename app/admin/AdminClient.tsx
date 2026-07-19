'use client'
import { useEffect, useState, useCallback } from 'react'

type Key = {
  id: string
  key_prefix: string
  tier: string
  created_at: string
  last_used_at: string | null
  revoked: boolean
  profiles: { email: string } | null
}
type FlaggedUsage = { id: number; identifier: string; tier: string; endpoint: string; status_code: number; created_at: string }

export default function AdminClient() {
  const [keys, setKeys] = useState<Key[]>([])
  const [flagged, setFlagged] = useState<FlaggedUsage[]>([])

  const load = useCallback(async () => {
    const [k, u] = await Promise.all([
      fetch('/api/admin/keys').then((r) => r.json()),
      fetch('/api/admin/usage').then((r) => r.json()),
    ])
    setKeys(Array.isArray(k) ? k : [])
    setFlagged(Array.isArray(u) ? u : [])
  }, [])

  useEffect(() => { load() }, [load])

  async function revoke(id: string) {
    if (!confirm('Revoke this key?')) return
    await fetch('/api/admin/keys', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    load()
  }

  return (
    <main className="min-h-screen">
      <nav className="flex items-center justify-between px-6 md:px-10 py-5 border-b" style={{ borderColor: 'var(--line)' }}>
        <a href="/" style={{ fontFamily: 'var(--font-display)' }} className="text-xl font-semibold">TruthLens</a>
        <span className="text-sm opacity-50">Admin</span>
      </nav>

      <div className="max-w-4xl mx-auto px-6 py-12 space-y-8">
        <h1 style={{ fontFamily: 'var(--font-display)' }} className="text-3xl">Admin</h1>

        <section className="rounded-2xl border p-6" style={{ borderColor: 'var(--line)', background: 'var(--paper)' }}>
          <h2 className="font-medium mb-1">API keys</h2>
          <p className="text-sm opacity-50 mb-5">{keys.filter((k) => !k.revoked).length} active, {keys.length} total (last 200)</p>
          {keys.length ? keys.map((k) => (
            <div key={k.id} className="rounded-lg border p-4 flex items-center justify-between" style={{ borderColor: 'var(--line)' }}>
              <div>
                <code className="text-sm" style={{ fontFamily: 'var(--font-mono)' }}>{k.key_prefix}••••</code>
                <span className="text-xs opacity-50 ml-2">{k.profiles?.email ?? 'unknown'}</span>
                <p className="text-xs opacity-40 mt-1">
                  created {new Date(k.created_at).toLocaleDateString()}
                  {k.last_used_at && ` · last used ${new Date(k.last_used_at).toLocaleDateString()}`}
                  {k.revoked && ' · revoked'}
                </p>
              </div>
              {!k.revoked && (
                <button onClick={() => revoke(k.id)} className="text-xs transition" style={{ color: 'var(--alter)' }}>Revoke</button>
              )}
            </div>
          )) : <p className="text-sm opacity-50">No keys yet.</p>}
        </section>

        <section className="rounded-2xl border p-6" style={{ borderColor: 'var(--line)', background: 'var(--paper)' }}>
          <h2 className="font-medium mb-1">Flagged usage</h2>
          <p className="text-sm opacity-50 mb-5">Rate-limited or errored requests (status ≥ 400), last 100</p>
          {flagged.length ? (
            <table className="w-full text-sm ledger">
              <thead>
                <tr className="opacity-50 text-left text-xs uppercase tracking-wider">
                  <th className="pb-2 font-normal">When</th>
                  <th className="pb-2 font-normal">Identifier</th>
                  <th className="pb-2 font-normal">Tier</th>
                  <th className="pb-2 font-normal text-right">Status</th>
                </tr>
              </thead>
              <tbody style={{ fontFamily: 'var(--font-mono)' }}>
                {flagged.map((f) => (
                  <tr key={f.id} className="border-t" style={{ borderColor: 'var(--line)' }}>
                    <td className="py-2.5">{new Date(f.created_at).toLocaleString()}</td>
                    <td className="py-2.5 truncate max-w-[16rem]">{f.identifier}</td>
                    <td className="py-2.5">{f.tier}</td>
                    <td className="py-2.5 text-right" style={{ color: 'var(--alter)' }}>{f.status_code}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-sm opacity-50">No flagged usage.</p>}
        </section>
      </div>
    </main>
  )
}
