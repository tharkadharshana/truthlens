import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { getDb } from '@/lib/db'
import { getAuthedUser } from '@/lib/auth'
import { generateKey } from '@/lib/keys'
import { FREE_PLAN, type PlanId } from '@/lib/plans'

export const runtime = 'nodejs'

export async function GET() {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Never return key_hash. Only the display prefix + metadata.
  const { data } = await getDb()
    .from('api_keys')
    .select('id, key_prefix, tier, created_at, last_used_at')
    .eq('user_id', user.id)
    .eq('revoked', false)

  return NextResponse.json(data ?? [])
}

export async function POST() {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // API access is a paid feature. Actual per-request authorization is always
  // re-derived live from profiles.plan (app/api/v1/check), so this check isn't
  // what makes billing un-abusable — a free-plan key would just get free-tier
  // treatment anyway. It exists so free users are steered to checkout instead
  // of quietly holding a key that does nothing useful yet.
  const { data: profile } = await getDb()
    .from('profiles')
    .select('plan')
    .eq('id', user.id)
    .maybeSingle()
  const plan = (profile?.plan as PlanId) ?? FREE_PLAN
  if (plan === FREE_PLAN) {
    return NextResponse.json(
      { error: 'API access requires a paid plan. Upgrade at /api/checkout?plan=pro or /api/checkout?plan=business.' },
      { status: 402 }
    )
  }

  // One active key per user (matches v1 intent).
  const { count } = await getDb()
    .from('api_keys')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('revoked', false)

  if ((count ?? 0) >= 1) {
    return NextResponse.json({ error: 'Revoke your existing key before creating a new one' }, { status: 409 })
  }

  const { raw, hash, prefix } = generateKey()
  const { error } = await getDb().from('api_keys').insert({
    user_id: user.id,
    key_hash: hash,
    key_prefix: prefix,
    // Display-only snapshot of the plan at creation time. Never trusted for
    // authorization — every request re-derives access from profiles.plan live
    // (app/api/v1/check/route.ts), so a later upgrade/downgrade/cancellation
    // takes effect immediately without touching this column or the key itself.
    tier: plan,
  })

  if (error) {
    console.error('key insert failed', error)
    Sentry.captureException(error)
    return NextResponse.json({ error: 'Failed to create key' }, { status: 500 })
  }

  // Raw key returned ONCE. We never store or show it again.
  return NextResponse.json({ key: raw, prefix }, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body?.id || typeof body.id !== 'string') {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  // Ownership guard: only revoke a key that belongs to this user.
  const { error } = await getDb()
    .from('api_keys')
    .update({ revoked: true })
    .eq('id', body.id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: 'Failed to revoke' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
