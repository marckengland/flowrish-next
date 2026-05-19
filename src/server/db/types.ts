/**
 * Helper to create tenant-scoped data without organizationId.
 *
 * The tenant middleware (createTenantPrisma) injects organizationId
 * automatically into all create operations for tenant-scoped models.
 * Prisma's generated types still require the field, so this function
 * provides a type-safe bridge: you pass data without organizationId,
 * and the return type satisfies Prisma's create input expectation.
 *
 * Usage:
 *   db.lead.create({ data: tenantData({ firstName, lastName, ... }) })
 *
 * Instead of:
 *   db.lead.create({ data: { firstName, lastName, ... } as any })
 */
export function tenantData<T extends Record<string, unknown>>(
  data: T,
): T & { organizationId: string; organization?: never } {
  return data as T & { organizationId: string; organization?: never }
}
