// Next.js's official startup hook (stable since Next 15, no config flag
// needed). Inert until SENTRY_DSN is set — Sentry.init() with no dsn just
// disables the SDK, so captureException() calls elsewhere are safe no-ops
// in any environment that hasn't configured it.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const Sentry = await import('@sentry/nextjs')
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 0.1,
    })
  }
}
