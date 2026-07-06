'use client'
import { useState } from 'react'
import { getBrowserClient } from '@/lib/supabase-browser'

export default function Login() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!email.includes('@')) { setError('Enter a valid email'); return }
    setError(''); setBusy(true)
    const { error } = await getBrowserClient().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/api/auth` },
    })
    setBusy(false)
    if (error) setError(error.message)
    else setSent(true)
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <a href="/" className="text-sm opacity-50 hover:opacity-100 transition mb-10 inline-block">← TruthLens</a>

        {sent ? (
          <div className="rounded-2xl border p-8 text-center" style={{ borderColor: 'var(--verdict-dim)' }}>
            <p style={{ fontFamily: 'var(--font-display)' }} className="text-2xl mb-2">Check your inbox</p>
            <p className="opacity-60 text-sm">A magic link is on its way to <span className="opacity-100">{email}</span>.</p>
          </div>
        ) : (
          <>
            <h1 style={{ fontFamily: 'var(--font-display)' }} className="text-3xl mb-2">Sign in</h1>
            <p className="opacity-60 text-sm mb-8">No password. We email you a one-time link.</p>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="you@firm.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              aria-label="Email address"
              className="w-full rounded-lg px-4 py-3 bg-transparent border focus:outline-none transition"
              style={{ borderColor: 'var(--line)' }}
            />
            {error && <p className="text-sm mt-3" style={{ color: 'var(--alter)' }}>{error}</p>}
            <button
              onClick={submit}
              disabled={busy || !email}
              className="w-full mt-4 py-3 rounded-lg font-medium text-[var(--ink)] disabled:opacity-30 transition"
              style={{ background: 'var(--verdict)' }}
            >
              {busy ? 'Sending…' : 'Send magic link'}
            </button>
          </>
        )}
      </div>
    </main>
  )
}
