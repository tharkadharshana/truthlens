// Cloudflare Turnstile verification. Inert (always passes) until
// TURNSTILE_SECRET_KEY is configured — so dev/test and any deploy that
// hasn't set it up yet aren't silently broken.
export async function verifyTurnstileToken(token: string | undefined, ip: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) return true
  if (!token) return false

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret, response: token, remoteip: ip }),
  })
  if (!res.ok) return false
  const data = await res.json()
  return data.success === true
}
