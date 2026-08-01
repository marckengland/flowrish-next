import { prisma } from '@/server/db/client'
import { AppError } from '@/lib/errors'
import {
  type Feature,
  type PlanSlug,
  FEATURE_LABEL,
  FEATURE_MIN_PLAN,
  normalizePlan,
  planHasFeature,
} from '@/lib/plans'

/**
 * Plan-based feature entitlements (subscription tier gating).
 *
 * This layers ON TOP of RBAC (`requirePermission`), not instead of it:
 *  - `requirePermission(user, ...)` → can this ROLE perform this action?
 *  - `requireEntitlement(orgId, ...)` → does this ORG's PLAN include this feature?
 *
 * The effective plan is always resolved server-side from `Organization.plan`
 * (never from client input), then normalized to a canonical PlanSlug.
 *
 * Validates: per-tier feature access.
 */

/**
 * Resolves an organization's effective plan from the database.
 * Falls back to the lowest tier if the org can't be found.
 */
export async function getOrganizationPlan(
  organizationId: string,
): Promise<PlanSlug> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { plan: true },
  })
  return normalizePlan(org?.plan)
}

/** True when the given organization's plan includes `feature`. */
export async function hasEntitlement(
  organizationId: string,
  feature: Feature,
): Promise<boolean> {
  const plan = await getOrganizationPlan(organizationId)
  return planHasFeature(plan, feature)
}

/**
 * Requires that the organization's plan includes `feature`. Throws a 403
 * AppError with code `UPGRADE_REQUIRED` (and the required plan) if not —
 * distinct from the 401 (auth) and 403 `FORBIDDEN` (RBAC) failures so the
 * client can prompt an upgrade rather than a login or permission error.
 *
 * Returns the resolved plan on success so callers can reuse it.
 */
export async function requireEntitlement(
  organizationId: string,
  feature: Feature,
): Promise<PlanSlug> {
  const plan = await getOrganizationPlan(organizationId)

  if (!planHasFeature(plan, feature)) {
    const requiredPlan = FEATURE_MIN_PLAN[feature]
    throw new AppError(
      'UPGRADE_REQUIRED',
      `${FEATURE_LABEL[feature]} requires the ${capitalize(requiredPlan)} plan. Upgrade to unlock it.`,
      403,
    )
  }

  return plan
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
