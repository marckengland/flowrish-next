import { createTenantPrisma, type TenantPrismaClient } from '@/server/db/middleware'
import { tenantData } from '@/server/db/types'
import { prisma } from '@/server/db/client'
import { AppError } from '@/lib/errors'

/**
 * Pipeline and stage service — handles pipeline creation, stage reordering,
 * and stage transition recording.
 *
 * Validates: Requirements 4.5, 17.2, 17.3, 34.1, 34.2
 */

/**
 * Default stages for the "Sales Pipeline" auto-created on first lead.
 * Order is 1-indexed and contiguous.
 */
const DEFAULT_STAGES = [
  { name: 'New', order: 1, isClosedWon: false, isClosedLost: false },
  { name: 'Qualified', order: 2, isClosedWon: false, isClosedLost: false },
  { name: 'Demoed', order: 3, isClosedWon: false, isClosedLost: false },
  { name: 'Sent Proposal', order: 4, isClosedWon: false, isClosedLost: false },
  { name: 'Closed Won', order: 5, isClosedWon: true, isClosedLost: false },
  { name: 'Closed Lost', order: 6, isClosedWon: false, isClosedLost: true },
] as const

/**
 * Gets the default pipeline for an organization, creating it if it doesn't exist.
 *
 * This is called when the first lead is created within an organization.
 * Creates a "Sales Pipeline" with 6 default stages:
 * New, Qualified, Demoed, Sent Proposal, Closed Won, Closed Lost.
 *
 * @param orgId - The organization ID
 * @returns The pipeline with its stages included
 */
export async function getOrCreateDefaultPipeline(orgId: string) {
  if (!orgId) {
    throw new AppError('VALIDATION_ERROR', 'Organization ID is required', 400)
  }

  const tenantPrisma = createTenantPrisma(orgId)

  // Check if a pipeline already exists for this organization
  const existingPipeline = await tenantPrisma.pipeline.findFirst({
    include: { stages: { orderBy: { order: 'asc' } } },
  })

  if (existingPipeline) {
    return existingPipeline
  }

  // Create the default pipeline with 6 stages using the base prisma client
  // (we include organizationId explicitly since Prisma types require it)
  const pipeline = await prisma.pipeline.create({
    data: {
      name: 'Sales Pipeline',
      organizationId: orgId,
      stages: {
        create: DEFAULT_STAGES.map((stage) => ({
          name: stage.name,
          order: stage.order,
          isClosedWon: stage.isClosedWon,
          isClosedLost: stage.isClosedLost,
        })),
      },
    },
    include: { stages: { orderBy: { order: 'asc' } } },
  })

  return pipeline
}

/**
 * Reorders stages within a pipeline. The provided stageIds array defines
 * the new order — stages are assigned contiguous integer orders starting from 1.
 *
 * Validates that all provided stageIds belong to the specified pipeline and
 * that no stages are lost or duplicated.
 *
 * @param pipelineId - The pipeline whose stages to reorder
 * @param stageIds - Array of stage IDs in the desired new order
 * @param orgId - The organization ID (for tenant scoping)
 * @returns The updated stages in their new order
 */
export async function reorderStages(
  pipelineId: string,
  stageIds: string[],
  orgId: string,
) {
  if (!pipelineId) {
    throw new AppError('VALIDATION_ERROR', 'Pipeline ID is required', 400)
  }
  if (!stageIds || stageIds.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'Stage IDs are required', 400)
  }
  if (!orgId) {
    throw new AppError('VALIDATION_ERROR', 'Organization ID is required', 400)
  }

  const tenantPrisma = createTenantPrisma(orgId)

  // Verify the pipeline exists and belongs to this organization
  const pipeline = await tenantPrisma.pipeline.findFirst({
    where: { id: pipelineId },
    include: { stages: true },
  })

  if (!pipeline) {
    throw new AppError('NOT_FOUND', 'Pipeline not found', 404)
  }

  // Validate all stageIds belong to this pipeline
  const existingStageIds = new Set(pipeline.stages.map((s) => s.id))
  const providedStageIds = new Set(stageIds)

  // Check for duplicates in the provided array
  if (providedStageIds.size !== stageIds.length) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Duplicate stage IDs are not allowed',
      400,
    )
  }

  // Check that all provided IDs belong to the pipeline
  for (const stageId of stageIds) {
    if (!existingStageIds.has(stageId)) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Stage ${stageId} does not belong to this pipeline`,
        400,
      )
    }
  }

  // Check that no stages are missing
  if (stageIds.length !== pipeline.stages.length) {
    throw new AppError(
      'VALIDATION_ERROR',
      'All stages must be included in the reorder — no stages can be lost or added',
      400,
    )
  }

  // Update stage orders as contiguous integers starting from 1.
  // Use a transaction with two passes to avoid unique constraint violations
  // on [pipelineId, order] during the reorder.
  const updatedStages = await prisma.$transaction(async (tx) => {
    // First pass: set all orders to negative values to clear the unique constraint
    for (let i = 0; i < stageIds.length; i++) {
      await tx.stage.update({
        where: { id: stageIds[i] },
        data: { order: -(i + 1) },
      })
    }

    // Second pass: set the final contiguous orders
    for (let i = 0; i < stageIds.length; i++) {
      await tx.stage.update({
        where: { id: stageIds[i] },
        data: { order: i + 1 },
      })
    }

    // Return the updated stages in order
    return tx.stage.findMany({
      where: { pipelineId },
      orderBy: { order: 'asc' },
    })
  })

  return updatedStages
}

/**
 * Records a stage transition for a lead. This creates a StageTransition
 * record tracking when a lead moved between pipeline stages.
 *
 * Accepts either an orgId string or a pre-created TenantPrismaClient
 * as the last parameter for flexibility.
 *
 * @param leadId - The lead that transitioned
 * @param fromStageId - The stage the lead moved from (null for initial placement)
 * @param toStageId - The stage the lead moved to
 * @param userId - The user who triggered the transition (null for system actions)
 * @param orgOrDb - Either an organization ID string or a TenantPrismaClient
 * @returns The created StageTransition record
 */
export async function createStageTransition(
  leadId: string,
  fromStageId: string | null,
  toStageId: string,
  userId: string | null,
  orgOrDb: string | TenantPrismaClient,
) {
  if (!leadId) {
    throw new AppError('VALIDATION_ERROR', 'Lead ID is required', 400)
  }
  if (!toStageId) {
    throw new AppError('VALIDATION_ERROR', 'Target stage ID is required', 400)
  }

  // Resolve the tenant-scoped client
  const db = typeof orgOrDb === 'string'
    ? createTenantPrisma(orgOrDb)
    : orgOrDb

  // Intentional `as any`: TenantPrismaClient's inferred type from $extends doesn't
  // expose all model accessors. The stageTransition model is available at runtime.
  const transition = await (db as any).stageTransition.create({
    data: tenantData({
      leadId,
      fromStageId: fromStageId ?? null,
      toStageId,
      userId: userId ?? null,
    }),
  })

  return transition
}
