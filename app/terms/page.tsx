export default function Terms() {
  return (
    <main className="min-h-screen px-6 md:px-10 py-16 max-w-3xl mx-auto">
      <a href="/" className="text-sm opacity-50 hover:opacity-100 transition mb-10 inline-block">← TruthLens</a>
      <div className="rounded-xl border px-5 py-4 mb-10 text-sm" style={{ borderColor: 'var(--alter)' }}>
        <strong>Draft — not legally reviewed.</strong> This is placeholder text, not a lawyer-reviewed
        terms of service. Do not treat it as a binding legal document.
      </div>
      <h1 style={{ fontFamily: 'var(--font-display)' }} className="text-4xl mb-8">Terms</h1>

      <Section title="What this is">
        <p>TruthLens compares text you submit against a limited corpus of legal and regulatory source material and returns an AI-generated verdict. Verdicts are informational only — not legal, financial, or compliance advice, and not a substitute for review by a qualified professional. See the disclaimer on every response.</p>
      </Section>

      <Section title="No warranty">
        <p>The service is provided as-is, without warranty of accuracy, completeness, or fitness for any particular purpose. Corpus coverage is limited and verdicts may be wrong, incomplete, or based on an insufficient source match.</p>
      </Section>

      <Section title="Acceptable use">
        <p>Don't use this service to generate content for unlawful purposes, don't attempt to circumvent rate limits or API key restrictions, and don't submit content you don't have the right to share (it will be sent to third-party AI providers — see the privacy page).</p>
      </Section>

      <Section title="API keys and billing">
        <p>Free tier: no key required, rate-limited by IP. Pro tier: API key required. Billing is not yet enforced — pricing shown on the landing page is indicative and subject to change before any charges begin.</p>
      </Section>

      <Section title="Changes">
        <p>These terms may change as the product develops. Continued use after a change means you accept the update.</p>
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
