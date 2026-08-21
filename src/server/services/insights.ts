import { prisma } from '@/server/db/client'
import { AppError } from '@/lib/errors'

/**
 * Insights service — persists and reads saved AI/enrichment output attached
 * to a Lead, Company, or Contact. Uses the base prisma client with an
 * explicit `organizationId` filter on every query (no tenant-middleware
 * coupling), so callers must always pass the caller's org.
 */

export const INSIGHT_ENTITY_TYPES = ['LEAD', 'COMPANY', 'CONTACT'] as const
export type InsightEntityType = (typeof INSIGHT_ENTITY_TYPES)[number]

export const INSIGHT_KINDS = ['research', 'background', 'leadgen'] as const
export type InsightKind = (typeof INSIGHT_KINDS)[number]

export interface CreateInsightInput {
  entityType: string
  entityId: string
  kind?: string
  summary?: string | null
  /** Required at runtime (validated below); optional in the type because
   * zod's `z.unknown()` yields an optional field. */
  data?: unknown
  sources?: string[]
  source?: string
}

function assertEntityType(value: string): InsightEntityType {
  if (!(INSIGHT_ENTITY_TYPES as readonly string[]).includes(value)) {
    throw new AppError(
      'VALIDATION_ERROR',
      `Invalid entityType "${value}". Expected one of ${INSIGHT_ENTITY_TYPES.join(', ')}.`,
      400,
    )
  }
  return value as InsightEntityType
}

/**
 * Creates a saved insight for an entity in the caller's organization.
 */
export async function createInsight(
  input: CreateInsightInput,
  userId: string,
  orgId: string,
) {
  if (!userId) throw new AppError('VALIDATION_ERROR', 'User ID is required', 400)
  if (!orgId) throw new AppError('VALIDATION_ERROR', 'Organization ID is required', 400)

  const entityType = assertEntityType(input.entityType)
  const entityId = input.entityId?.trim()
  if (!entityId) throw new AppError('VALIDATION_ERROR', 'entityId is required', 400)
  if (input.data === undefined || input.data === null) {
    throw new AppError('VALIDATION_ERROR', 'data is required', 400)
  }

  const kind =
    input.kind && (INSIGHT_KINDS as readonly string[]).includes(input.kind)
      ? input.kind
      : 'research'

  return prisma.insight.create({
    data: {
      entityType,
      entityId,
      kind,
      summary: input.summary ?? null,
      // Prisma's Json input accepts serializable values.
      data: input.data as object,
      sources: Array.isArray(input.sources) ? input.sources.slice(0, 50) : [],
      source: input.source ?? 'ai',
      createdById: userId,
      organizationId: orgId,
    },
  })
}

/**
 * Lists saved insights for an entity, newest first, scoped to the org.
 */
export async function listInsights(
  entityType: string,
  entityId: string,
  orgId: string,
) {
  if (!orgId) throw new AppError('VALIDATION_ERROR', 'Organization ID is required', 400)
  const type = assertEntityType(entityType)
  if (!entityId?.trim()) {
    throw new AppError('VALIDATION_ERROR', 'entityId is required', 400)
  }

  return prisma.insight.findMany({
    where: { organizationId: orgId, entityType: type, entityId: entityId.trim() },
    orderBy: { createdAt: 'desc' },
  })
}

/**
 * Deletes a saved insight, verifying it belongs to the caller's org.
 */
export async function deleteInsight(id: string, orgId: string): Promise<void> {
  if (!orgId) throw new AppError('VALIDATION_ERROR', 'Organization ID is required', 400)
  const existing = await prisma.insight.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true },
  })
  if (!existing) throw new AppError('NOT_FOUND', 'Insight not found', 404)
  await prisma.insight.delete({ where: { id } })
}
