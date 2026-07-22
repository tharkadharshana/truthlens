import type { Domain } from './domains'

// Plans are the billing boundary, expressed as data. A plan bundles the limits
// and capabilities a customer gets; Polar products map onto these by id (env).
// Adding or retiering is a config change here, not scattered conditionals.

export type PlanId = 'free' | 'pro' | 'business'

export type Plan = {
  id: PlanId
  label: string
  requiresKey: boolean          // free needs no key; paid plans do
  rateLimitPerHour: number
  maxClaims: number             // claims verified per request
  domains: readonly Domain[]    // which domains this plan may call
  history: boolean              // saved check history in the dashboard
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    label: 'Free',
    requiresKey: false,
    rateLimitPerHour: 5,
    maxClaims: 3,
    domains: ['general'],
    history: false,
  },
  pro: {
    id: 'pro',
    label: 'Pro',
    requiresKey: true,
    rateLimitPerHour: 1000,
    maxClaims: 8,
    domains: ['general'],
    history: true,
  },
  business: {
    id: 'business',
    label: 'Business',
    requiresKey: true,
    rateLimitPerHour: 1000,
    maxClaims: 8,
    domains: ['general', 'legal_statute', 'finra_compliance'],
    history: true,
  },
}

export const FREE_PLAN: PlanId = 'free'

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && value in PLANS
}

export function planCanUseDomain(plan: PlanId, domain: Domain): boolean {
  return PLANS[plan].domains.includes(domain)
}

// Polar product id -> our plan. Set POLAR_PRODUCT_PRO / POLAR_PRODUCT_BUSINESS
// in env after creating the products in Polar. An unrecognized product maps to
// null so a stray webhook can never silently grant access.
export function planForPolarProduct(productId: string | undefined | null): PlanId | null {
  if (!productId) return null
  if (productId === process.env.POLAR_PRODUCT_BUSINESS) return 'business'
  if (productId === process.env.POLAR_PRODUCT_PRO) return 'pro'
  return null
}

// A Polar subscription only grants access while it's paying. Anything else
// (canceled, past_due, unpaid) falls back to free — access is derived from
// payment state, never from what the user last had.
export function isActivePolarStatus(status: string | undefined | null): boolean {
  return status === 'active' || status === 'trialing'
}

export type ProfilePatch = {
  plan: PlanId
  subscription_status: string | null
  polar_customer_id: string | null
  current_period_end: string | null
}

// Pure field-mapping from a Polar subscription webhook payload to the profile
// row update — no I/O, fully unit-testable. app/api/webhooks/polar does the
// actual DB write; this is the logic that decides what to write and why.
// Field names vary snake_case (raw wire format) vs camelCase (SDK-parsed
// object) — accept either, since the payload delivered to a handler here is
// SDK-parsed (camelCase) but defensive fallbacks cost nothing.
export function subscriptionToProfilePatch(sub: any): { externalId: string | null; email: string | null; patch: ProfilePatch } | null {
  const productId = sub?.productId ?? sub?.product_id ?? sub?.product?.id
  const plan = planForPolarProduct(productId)
  if (!plan) return null // unrecognized product must never grant access

  const status = sub?.status ?? null
  return {
    externalId: sub?.customer?.externalId ?? sub?.customer?.external_id ?? sub?.customerExternalId ?? sub?.customer_external_id ?? null,
    email: sub?.customer?.email ?? null,
    patch: {
      // Access is derived from status, not from which webhook event fired.
      // Polar's "canceled" means cancel-at-period-end — status typically
      // stays 'active' until the period actually ends, and access should
      // continue until then. Any non-active/trialing status revokes it. Never
      // trust the event name alone — a stale/reordered delivery of
      // subscription.created for an already-canceled subscription must not
      // resurrect access.
      plan: isActivePolarStatus(status) ? plan : FREE_PLAN,
      subscription_status: status,
      polar_customer_id: sub?.customerId ?? sub?.customer_id ?? sub?.customer?.id ?? null,
      current_period_end: sub?.currentPeriodEnd ?? sub?.current_period_end ?? null,
    },
  }
}
