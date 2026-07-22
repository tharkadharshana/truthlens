import { Webhooks } from '@polar-sh/nextjs'
import * as Sentry from '@sentry/nextjs'
import { getDb } from '@/lib/db'
import { subscriptionToProfilePatch } from '@/lib/plans'

export const runtime = 'nodejs'

// The Polar webhook is the ONLY writer of billing state on profiles. Every
// event re-derives `plan` from the subscription's current `status` (see
// subscriptionToProfilePatch in lib/plans.ts) — never from which event fired —
// so a user can never grant themselves a plan and a canceled/unpaid
// subscription always reverts to free. Signature verification is handled by
// the Webhooks() helper using POLAR_WEBHOOK_SECRET; an unsigned/forged
// request is rejected before any handler runs.
async function syncSubscription(sub: any): Promise<void> {
  const mapped = subscriptionToProfilePatch(sub)
  if (!mapped) {
    console.warn('polar webhook: unrecognized product id, ignoring', sub?.productId ?? sub?.product_id)
    return
  }
  const { externalId, email, patch } = mapped

  const db = getDb()
  // Match by our user id (passed as customer external id at checkout) first,
  // falling back to email if a subscription predates external-id wiring.
  const q = externalId
    ? db.from('profiles').update(patch).eq('id', externalId)
    : email
      ? db.from('profiles').update(patch).eq('email', email)
      : null

  if (!q) {
    console.error('polar webhook: subscription has no external id or email, cannot map to a user')
    return
  }
  const { error } = await q
  if (error) {
    console.error('polar webhook: profile update failed', error.message)
    Sentry.captureException(error)
  }
}

export const POST = Webhooks({
  webhookSecret: process.env.POLAR_WEBHOOK_SECRET ?? '',
  // Every subscription lifecycle event re-syncs the profile from its status
  // (see syncSubscription) — the specific event only decides when we re-check.
  onSubscriptionCreated: async (p) => syncSubscription(p.data),
  onSubscriptionActive: async (p) => syncSubscription(p.data),
  onSubscriptionUpdated: async (p) => syncSubscription(p.data),
  onSubscriptionUncanceled: async (p) => syncSubscription(p.data),
  onSubscriptionCanceled: async (p) => syncSubscription(p.data),
  onSubscriptionRevoked: async (p) => syncSubscription(p.data),
})
