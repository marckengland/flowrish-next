import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

/**
 * Property-based tests for pipeline stage reordering.
 *
 * These tests verify that:
 * 1. Stage reorder preserves all stages (no stages lost or duplicated)
 * 2. Stage orders are always contiguous integers starting from 1
 *
 * **Validates: Requirements 17.3, 17.4**
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Track transaction updates to verify ordering behavior
let transactionUpdates: Array<{ id: string; order: number }> = []

const { mockTenantPrisma, mockTransaction } = vi.hoisted(() => {
  const mockTransaction = vi.fn()
  const mockTenantPrisma = {
    pipeline: {
      findFirst: vi.fn(),
    },
  }
  return { mockTenantPrisma, mockTransaction }
})

vi.mock('@/server/db/middleware', () => ({
  createTenantPrisma: vi.fn(() => mockTenantPrisma),
  TENANT_SCOPED_MODELS: ['Pipeline', 'Stage'],
}))

vi.mock('@/server/db/client', () => ({
  prisma: {
    $transaction: mockTransaction,
    $extends: vi.fn(),
  },
}))

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(),
}))

import { reorderStages } from '@/server/services/pipeline'

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a valid UUID for IDs */
const uuidArb = fc.uuid()

/**
 * Generate a list of unique stage IDs representing stages in a pipeline.
 * Minimum 2 stages (a pipeline needs at least 2 stages to reorder meaningfully).
 */
const stageIdsArb = fc
  .uniqueArray(uuidArb, { minLength: 2, maxLength: 10 })

/**
 * Generate a pipeline scenario with existing stages and a permutation for reordering.
 * - existingStageIds: the stages currently in the pipeline
 * - reorderedStageIds: a permutation of the same IDs (the new desired order)
 */
const reorderScenarioArb = stageIdsArb.chain((stageIds) =>
  fc.record({
    pipelineId: uuidArb,
    orgId: uuidArb,
    existingStageIds: fc.constant(stageIds),
    reorderedStageIds: fc.shuffledSubarray(stageIds, {
      minLength: stageIds.length,
      maxLength: stageIds.length,
    }),
  }),
)

/**
 * Generate a scenario with duplicate IDs (invalid input).
 */
const duplicateIdsScenarioArb = stageIdsArb.chain((stageIds) =>
  fc.record({
    pipelineId: uuidArb,
    orgId: uuidArb,
    existingStageIds: fc.constant(stageIds),
    // Pick a random element to duplicate
    duplicateIndex: fc.integer({ min: 0, max: stageIds.length - 1 }),
  }),
)

/**
 * Generate a scenario with missing IDs (subset of existing stages).
 */
const missingIdsScenarioArb = stageIdsArb
  .filter((ids) => ids.length >= 3) // need at least 3 to remove one and still have 2+
  .chain((stageIds) =>
    fc.record({
      pipelineId: uuidArb,
      orgId: uuidArb,
      existingStageIds: fc.constant(stageIds),
      // Remove one stage to create a "missing" scenario
      removeIndex: fc.integer({ min: 0, max: stageIds.length - 1 }),
    }),
  )

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Pipeline Stage Reordering - Property Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    transactionUpdates = []
  })

  /**
   * Helper: sets up mocks for a successful reorder scenario.
   * Returns the final stages that the transaction will produce.
   */
  function setupSuccessfulReorder(
    pipelineId: string,
    existingStageIds: string[],
    reorderedStageIds: string[],
  ) {
    // Mock pipeline.findFirst to return the pipeline with existing stages
    mockTenantPrisma.pipeline.findFirst.mockResolvedValue({
      id: pipelineId,
      stages: existingStageIds.map((id, index) => ({
        id,
        order: index + 1,
        pipelineId,
      })),
    })

    // The expected final stages after reorder
    const expectedFinalStages = reorderedStageIds.map((id, index) => ({
      id,
      order: index + 1,
      pipelineId,
    }))

    // Mock $transaction to simulate the two-pass update and return final stages
    mockTransaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => {
      transactionUpdates = []
      const tx = {
        stage: {
          update: vi.fn().mockImplementation(async ({ where, data }) => {
            transactionUpdates.push({ id: where.id, order: data.order })
            return { id: where.id, order: data.order }
          }),
          findMany: vi.fn().mockResolvedValue(expectedFinalStages),
        },
      }
      return fn(tx)
    })

    return expectedFinalStages
  }

  describe('Property: Stage reorder preserves all stages (no stages lost or duplicated)', () => {
    /**
     * **Validates: Requirements 17.3**
     *
     * After a reorder operation, the set of stage IDs in the pipeline
     * must be exactly the same as before — no stages are lost and no
     * stages are duplicated. Any permutation of valid stage IDs is accepted.
     */

    it('any permutation of valid stage IDs is accepted and preserves all stages', async () => {
      await fc.assert(
        fc.asyncProperty(reorderScenarioArb, async (scenario) => {
          const { pipelineId, orgId, existingStageIds, reorderedStageIds } = scenario

          const expectedFinalStages = setupSuccessfulReorder(
            pipelineId,
            existingStageIds,
            reorderedStageIds,
          )

          const result = await reorderStages(pipelineId, reorderedStageIds, orgId)

          // The result must contain exactly the same set of stage IDs
          const resultIds = new Set(result.map((s: any) => s.id))
          const originalIds = new Set(existingStageIds)

          expect(resultIds.size).toBe(originalIds.size)
          for (const id of originalIds) {
            expect(resultIds.has(id)).toBe(true)
          }
        }),
      )
    })

    it('the transaction updates every stage exactly once in the final pass', async () => {
      await fc.assert(
        fc.asyncProperty(reorderScenarioArb, async (scenario) => {
          const { pipelineId, orgId, existingStageIds, reorderedStageIds } = scenario

          setupSuccessfulReorder(pipelineId, existingStageIds, reorderedStageIds)

          await reorderStages(pipelineId, reorderedStageIds, orgId)

          // The transaction should have 2 * N updates (first pass negative, second pass positive)
          expect(transactionUpdates.length).toBe(reorderedStageIds.length * 2)

          // Second pass (positive orders) should cover all stage IDs exactly once
          const secondPassUpdates = transactionUpdates.slice(reorderedStageIds.length)
          const updatedIds = new Set(secondPassUpdates.map((u) => u.id))
          expect(updatedIds.size).toBe(reorderedStageIds.length)

          for (const id of reorderedStageIds) {
            expect(updatedIds.has(id)).toBe(true)
          }
        }),
      )
    })

    it('duplicate stage IDs in the input are rejected', async () => {
      await fc.assert(
        fc.asyncProperty(duplicateIdsScenarioArb, async (scenario) => {
          const { pipelineId, orgId, existingStageIds, duplicateIndex } = scenario

          // Create input with a duplicate
          const duplicatedIds = [...existingStageIds, existingStageIds[duplicateIndex]]

          // Mock pipeline.findFirst to return the pipeline with existing stages
          mockTenantPrisma.pipeline.findFirst.mockResolvedValue({
            id: pipelineId,
            stages: existingStageIds.map((id, index) => ({
              id,
              order: index + 1,
              pipelineId,
            })),
          })

          await expect(
            reorderStages(pipelineId, duplicatedIds, orgId),
          ).rejects.toThrow()
        }),
      )
    })

    it('missing stage IDs (subset of existing) are rejected', async () => {
      await fc.assert(
        fc.asyncProperty(missingIdsScenarioArb, async (scenario) => {
          const { pipelineId, orgId, existingStageIds, removeIndex } = scenario

          // Create input with one stage missing
          const missingIds = existingStageIds.filter(
            (_, i) => i !== removeIndex,
          )

          // Mock pipeline.findFirst to return the pipeline with existing stages
          mockTenantPrisma.pipeline.findFirst.mockResolvedValue({
            id: pipelineId,
            stages: existingStageIds.map((id, index) => ({
              id,
              order: index + 1,
              pipelineId,
            })),
          })

          await expect(
            reorderStages(pipelineId, missingIds, orgId),
          ).rejects.toThrow()
        }),
      )
    })
  })

  describe('Property: Stage orders are always contiguous integers starting from 1', () => {
    /**
     * **Validates: Requirements 17.4**
     *
     * After any reorder operation, the stage orders must form a sequence
     * of contiguous integers starting from 1: [1, 2, 3, ..., n].
     * There are no gaps, no zeros, and no repeated order values.
     */

    it('after reorder, stages have orders 1 through N with no gaps', async () => {
      await fc.assert(
        fc.asyncProperty(reorderScenarioArb, async (scenario) => {
          const { pipelineId, orgId, existingStageIds, reorderedStageIds } = scenario

          setupSuccessfulReorder(pipelineId, existingStageIds, reorderedStageIds)

          const result = await reorderStages(pipelineId, reorderedStageIds, orgId)

          // Extract orders and verify they are contiguous from 1
          const orders = result.map((s: any) => s.order).sort((a: number, b: number) => a - b)

          expect(orders.length).toBe(reorderedStageIds.length)
          for (let i = 0; i < orders.length; i++) {
            expect(orders[i]).toBe(i + 1)
          }
        }),
      )
    })

    it('the transaction assigns contiguous positive integers in the second pass', async () => {
      await fc.assert(
        fc.asyncProperty(reorderScenarioArb, async (scenario) => {
          const { pipelineId, orgId, existingStageIds, reorderedStageIds } = scenario

          setupSuccessfulReorder(pipelineId, existingStageIds, reorderedStageIds)

          await reorderStages(pipelineId, reorderedStageIds, orgId)

          // Second pass updates should assign orders 1, 2, 3, ..., N
          const secondPassUpdates = transactionUpdates.slice(reorderedStageIds.length)
          const assignedOrders = secondPassUpdates
            .map((u) => u.order)
            .sort((a, b) => a - b)

          expect(assignedOrders.length).toBe(reorderedStageIds.length)
          for (let i = 0; i < assignedOrders.length; i++) {
            expect(assignedOrders[i]).toBe(i + 1)
          }
        }),
      )
    })

    it('each stage ID maps to its positional index + 1 in the input array', async () => {
      await fc.assert(
        fc.asyncProperty(reorderScenarioArb, async (scenario) => {
          const { pipelineId, orgId, existingStageIds, reorderedStageIds } = scenario

          setupSuccessfulReorder(pipelineId, existingStageIds, reorderedStageIds)

          await reorderStages(pipelineId, reorderedStageIds, orgId)

          // Second pass: each stage should get order = its position + 1
          const secondPassUpdates = transactionUpdates.slice(reorderedStageIds.length)

          for (let i = 0; i < reorderedStageIds.length; i++) {
            const update = secondPassUpdates[i]
            expect(update.id).toBe(reorderedStageIds[i])
            expect(update.order).toBe(i + 1)
          }
        }),
      )
    })

    it('first pass uses negative orders to avoid unique constraint violations', async () => {
      await fc.assert(
        fc.asyncProperty(reorderScenarioArb, async (scenario) => {
          const { pipelineId, orgId, existingStageIds, reorderedStageIds } = scenario

          setupSuccessfulReorder(pipelineId, existingStageIds, reorderedStageIds)

          await reorderStages(pipelineId, reorderedStageIds, orgId)

          // First pass updates should all have negative orders
          const firstPassUpdates = transactionUpdates.slice(0, reorderedStageIds.length)

          for (const update of firstPassUpdates) {
            expect(update.order).toBeLessThan(0)
          }
        }),
      )
    })
  })
})
