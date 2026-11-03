/**
 * Subscription plans — the single source of truth for Flowrish pricing tiers
 * and per-tier feature access.
 *
 * This module is intentionally framework-agnostic and client-safe (no
 * `server-only`, no DB, no secrets) so it can be imported by BOTH:
 *  - the marketing pricing UI (`src/components/marketing/pricing-section.tsx`), and
 *  - the server-side entitlement guard (`src/server/auth/entitlements.ts`).
 *
 * The `Organization.plan` column stores one of PLAN_SLUGS. Legacy/unknown
 * values are normalized to the lowest tier by `normalizePlan()`.
 */

/** Canonical plan identifiers, ordered lowest → highest. */
export const PLAN_SLUGS = ['starter', 'growth', 'enterprise'] as const
export type PlanSlug = (typeof PLAN_SLUGS)[number]

/**
 * Rank used for "plan A satisfies feature requiring plan B" comparisons.
 * Higher = more access.
 */
export const PLAN_RANK: Record<PlanSlug, number> = {
  starter: 0,
  growth: 1,
  enterprise: 2,
}

/**
 * Gated, plan-restricted product capabilities. RBAC permissions
 * (`requirePermission`) still apply on top of these — entitlements gate the
 * feature at the plan level, permissions gate the action at the role level.
 */
export const FEATURES = ['cadences', 'forecasting', 'ai'] as const
export type Feature = (typeof FEATURES)[number]

/** Minimum plan required for each gated feature. */
export const FEATURE_MIN_PLAN: Record<Feature, PlanSlug> = {
  cadences: 'growth',
  forecasting: 'growth',
  ai: 'growth',
}

/** Human-readable label for each gated feature (used in upgrade prompts). */
export const FEATURE_LABEL: Record<Feature, string> = {
  cadences: 'Cadences & Rhythm engine',
  forecasting: 'Revenue forecasting',
  ai: 'AI email & research',
}

/**
 * Normalizes any stored/legacy plan value to a canonical PlanSlug.
 *
 * The `Organization.plan` column historically defaulted to "free" and used
 * "pro"/"enterprise" comments; map those onto the current tiers. Anything
 * unrecognized falls back to the lowest tier so access is never over-granted.
 */
export function normalizePlan(raw: string | null | undefined): PlanSlug {
  switch ((raw ?? '').toLowerCase()) {
    case 'growth':
    case 'pro': // legacy alias
      return 'growth'
    case 'enterprise':
      return 'enterprise'
    case 'starter':
    case 'free': // legacy default
    default:
      return 'starter'
  }
}

/** True when `plan` is entitled to `feature`. */
export function planHasFeature(plan: PlanSlug, feature: Feature): boolean {
  return PLAN_RANK[plan] >= PLAN_RANK[FEATURE_MIN_PLAN[feature]]
}

// ─── Marketing tier presentation ─────────────────────────────────────────────

export interface PlanTier {
  slug: PlanSlug
  name: string
  blurb: string
  /** Feature bullets shown on the pricing card. */
  features: string[]
  featured?: boolean
}

/** Approved public pricing wording until commercial terms are confirmed. */
export const PUBLIC_PRICING_MESSAGE = 'Our team will confirm pricing'

/** Plan descriptions and feature lists; access is enforced by FEATURE_MIN_PLAN. */
export const PLAN_TIERS: PlanTier[] = [
  {
    slug: 'starter',
    name: 'Starter',
    blurb: 'For small teams getting organized.',
    features: [
      'Lead & contact management',
      'Kanban pipeline',
      'CSV import / export',
    ],
  },
  {
    slug: 'growth',
    name: 'Growth',
    blurb: 'Automation and forecasting for scaling teams.',
    features: [
      'Everything in Starter',
      'Cadences & Rhythm engine',
      'Revenue forecasting',
      'AI email & research',
    ],
    featured: true,
  },
  {
    slug: 'enterprise',
    name: 'Enterprise',
    blurb: 'Governance and control for large orgs.',
    features: [
      'Everything in Growth',
      'Custom roles & SSO',
      'Audit log & SLAs',
    ],
  },
]
