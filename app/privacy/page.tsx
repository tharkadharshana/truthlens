export default function Privacy() {
  return (
    <main className="min-h-screen px-6 md:px-10 py-16 max-w-3xl mx-auto">
      <a href="/" className="text-sm opacity-50 hover:opacity-100 transition mb-10 inline-block">← TruthLens</a>
      <div className="rounded-xl border px-5 py-4 mb-10 text-sm" style={{ borderColor: 'var(--alter)' }}>
        <strong>Draft — not legally reviewed.</strong> This is placeholder text describing current
        data handling, not a lawyer-reviewed privacy policy. Do not treat it as a binding legal document.
      </div>
      <h1 style={{ fontFamily: 'var(--font-display)' }} className="text-4xl mb-8">Privacy</h1>

      <Section title="What we collect">
        <p>Email address, if you sign in (magic-link authentication via Supabase — no password is ever collected or stored).</p>
        <p>API keys are stored as SHA-256 hashes only. The raw key is shown once at creation and never stored in retrievable form.</p>
        <p>Text you submit to the claim-verification endpoint, and your IP address (used only for free-tier rate limiting, not stored longer than the rate-limit window).</p>
        <p>Usage metadata: request counts, claim counts, timestamps, and status codes, associated with your account or IP — used for rate limiting and billing.</p>
        <p><strong>Submitted text and results are stored.</strong> Each check — the text you submit and the verdict produced — is saved to power your check history and a shared response cache (an identical submission may be served a previously computed result to save cost and time). This includes anonymous checks made without an account, which are stored but not linked to any identity beyond the request. Signed-in users can view their own history from the dashboard.</p>
      </Section>

      <Section title="Where it goes">
        <p>Submitted claim text is sent to third-party AI providers to generate a verdict: Google (Gemini, always, for retrieval) and whichever of Google, OpenAI, or DeepSeek is configured for verdict generation. Each provider processes that text under its own terms — we do not control their retention policies.</p>
        <p>For general fact-checking, your text (or an English translation of it) is also sent as a search query to evidence providers — Wikipedia, Google Fact Check Tools, and, for API-key requests, Tavily and GNews — to retrieve the sources a verdict cites.</p>
        <p>Account, usage, and check-history data is stored with Supabase (Postgres) and Upstash (Redis), both third-party infrastructure providers.</p>
        <p>If you subscribe to a paid plan, billing and payment processing is handled entirely by Polar.sh — we never see or store your card details. Polar shares your subscription status back to us so we can grant or remove API access.</p>
      </Section>

      <Section title="What we don't do">
        <p>We don't sell your data. We don't run third-party analytics or ad trackers on this site.</p>
      </Section>

      <Section title="Your options">
        <p>Revoke an API key any time from the dashboard. Contact us to request account deletion.</p>
      </Section>
    </main>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 style={{ fontFamily: 'var(--font-display)' }} className="text-xl mb-3">{title}</h2>
      <div className="space-y-2 text-sm opacity-80 leading-relaxed">{children}</div>
    </section>
  )
}
