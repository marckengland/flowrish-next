import { createTenantPrisma } from '@/server/db/middleware'
import { tenantData } from '@/server/db/types'
import { AppError } from '@/lib/errors'
import type { SessionUser } from '@/server/auth/session'
import { sanitizedString, nullableSanitizedString } from '@/lib/validators/common'
import { z } from 'zod'

/**
 * Entity types that support the deletion request workflow.
 *
 * - Lead: soft-deleted on approval (sets deletedAt)
 * - Contact: hard-deleted on approval
 * - Task: hard-deleted on approval
 */
export const deletionEntityTypeEnum = z.enum(['Lead', 'Contact', 'Task'])
export type DeletionEntityType = z.infer<typeof deletionEntityTypeEnum>

/**
 * Valid statuses for a DeletionRequest.
 */
export type DeletionRequestStatus = 'pending' | 'approved' | 'rejected'

/**
 * Schema for creating a DeletionRequest.
 *
 * - entityType: "Lead", "Contact", or "Task"
 * - entityId: UUID of the target entity
 * - entityName: display name for the entity (e.g. "John Doe")
 * - reason: optional free-text justification
 */
export const deletionRequestCreateSchema = z.object({
  entityType: deletionEntityTypeEnum,
  entityId: z.string().uuid('Invalid entity ID'),
  entityName: sanitizedString.pipe(z.string().min(1, 'Entity name is required').max(500)),
  reason: nullableSanitizedString,
})

export type DeletionRequestCreateInput = z.infer<typeof deletionRequestCreateSchema>

/**
 * Filters for listing deletion requests.
 */
export interface DeletionRequestFilters {
  status?: DeletionRequestStatus
  entityType?: DeletionEntityType
  requestedById?: string
}

/**
 * Determines whether a user can directly delete records without going
 * through the deletion request approval workflow.
 *
 * MANAGER (hierarchy 2), ADMIN (hierarchy 1), and OWNER (hierarchy 0)
 * can bypass the workflow. MEMBERs (hierarchy 3+) must request approval.
 *
 * Validates: Requirement 33.5
 */
export function canDirectDelete(user: SessionUser): boolean {
  if (user.teamMemberships.length === 0) return false
  const highestPrivilege = Math.min(
    ...user.teamMemberships.map((m) => m.role.hierarchy),
  )
  return highestPrivilege <= 2
}

/**
 * Creates a DeletionRequest with status "pending".
 *
 * - Validates input with Zod (entityType, entityId, entityName, optional reason)
 * - Rejects duplicate requests: if a pending request for the same
 *   (entityType, entityId) already exists in this org, throws CONFLICT
 * - Persists with auto-injected organizationId via tenant middleware
 *
 * Validates: Requirements 33.1, 33.2
 */
export async function requestDeletion(
  userId: string,
  orgId: string,
  data: unknown,
) {
  if (!userId) {
    throw new AppError('VALIDATION_ERROR', 'User ID is required', 400)
  }
  if (!orgId) {
    throw new AppError('VALIDATION_ERROR', 'Organization ID is required', 400)
  }

  const validated = deletionRequestCreateSchema.parse(data)

  const db = createTenantPrisma(orgId)

  // Reject if a pending request already exists for the same entity
  const existing = await db.deletionRequest.findFirst({
    where: {
      entityType: validated.entityType,
      entityId: validated.entityId,
      status: 'pending',
    },
  })

  if (existing) {
    throw new AppError(
      'DUPLICATE_REQUEST',
      'A pending deletion request already exists for this entity',
      409,
    )
  }

  const request = await db.deletionRequest.create({
    data: tenantData({
      entityType: validated.entityType,
      entityId: validated.entityId,
      entityName: validated.entityName,
      reason: validated.reason ?? null,
      requestedById: userId,
      status: 'pending',
    }),
  })

  return request
}

/**
 * Lists pending deletion requests for the organization, ordered by
 * createdAt ascending (oldest first). Intended for manager/admin review.
 *
 * Validates: Requirement 33.6
 */
export async function listPendingRequests(orgId: string) {
  if (!orgId) {
    throw new AppError('VALIDATION_ERROR', 'Organization ID is required', 400)
  }

  const db = createTenantPrisma(orgId)

  const requests = await db.deletionRequest.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
    include: {
      requestedBy: { select: { id: true, name: true, email: true } },
    },
  })

  return requests
}

/**
 * Lists deletion requests matching the provided filters, ordered by
 * createdAt descending (newest first).
 *
 * Supports filtering by status, entityType, and requestedById.
 *
 * Validates: Requirement 33.6
 */
export async function listDeletionRequests(
  orgId: string,
  filters: DeletionRequestFilters = {},
) {
  if (!orgId) {
    throw new AppError('VALIDATION_ERROR', 'Organization ID is required', 400)
  }

  const db = createTenantPrisma(orgId)

  const where: Record<string, unknown> = {}
  if (filters.status) where.status = filters.status
  if (filters.entityType) where.entityType = filters.entityType
  if (filters.requestedById) where.requestedById = filters.requestedById

  const requests = await db.deletionRequest.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      requestedBy: { select: { id: true, name: true, email: true } },
    },
  })

  return requests
}

/**
 * Approves a pending DeletionRequest and executes the deletion.
 *
 * - Validates the request exists and is in "pending" status
 * - Executes the deletion:
 *   - Lead: soft-delete (sets deletedAt)
 *   - Contact: hard delete
 *   - Task: hard delete
 * - Marks the request as "approved" with reviewer info
 *
 * The deletion and status update run inside the tenant-scoped middleware,
 * which enforces organization isolation.
 *
 * Validates: Requirement 33.3
 */
export async function approveRequest(
  requestId: string,
  reviewerId: string,
  orgId: string,
) {
  if (!requestId) {
    throw new AppError('VALIDATION_ERROR', 'Request ID is required', 400)
  }
  if (!reviewerId) {
    throw new AppError('VALIDATION_ERROR', 'Reviewer ID is required', 400)
  }
  if (!orgId) {
    throw new AppError('VALIDATION_ERROR', 'Organization ID is required', 400)
  }

  const db = createTenantPrisma(orgId)

  const request = await db.deletionRequest.findFirst({
    where: { id: requestId },
  })

  if (!request) {
    throw new AppError('NOT_FOUND', 'Deletion request not found', 404)
  }

  if (request.status !== 'pending') {
    throw new AppError(
      'INVALID_STATE',
      `Cannot approve a request that is already ${request.status}`,
      400,
    )
  }

  // Execute the deletion based on the entity type.
  // Lead: soft-delete. Contact/Task: hard-delete.
  const entityType = request.entityType as DeletionEntityType
  switch (entityType) {
    case 'Lead': {
      const lead = await db.lead.findFirst({ where: { id: request.entityId } })
      if (lead && lead.deletedAt === null) {
        await db.lead.update({
          where: { id: request.entityId },
          data: { deletedAt: new Date() },
        })
      }
      break
    }
    case 'Contact': {
      const contact = await db.contact.findFirst({ where: { id: request.entityId } })
      if (contact) {
        await db.contact.delete({ where: { id: request.entityId } })
      }
      break
    }
    case 'Task': {
      const task = await db.task.findFirst({ where: { id: request.entityId } })
      if (task) {
        await db.task.delete({ where: { id: request.entityId } })
      }
      break
    }
    default: {
      throw new AppError(
        'VALIDATION_ERROR',
        `Unsupported entity type: ${request.entityType}`,
        400,
      )
    }
  }

  const approved = await db.deletionRequest.update({
    where: { id: requestId },
    data: {
      status: 'approved',
      reviewedById: reviewerId,
      reviewedAt: new Date(),
    },
  })

  return approved
}

/**
 * Rejects a pending DeletionRequest without executing any deletion.
 *
 * - Validates the request exists and is in "pending" status
 * - Marks the request as "rejected" with reviewer info
 * - No deletion is performed on the target entity
 *
 * Validates: Requirement 33.4
 */
export async function rejectRequest(
  requestId: string,
  reviewerId: string,
  orgId: string,
) {
  if (!requestId) {
    throw new AppError('VALIDATION_ERROR', 'Request ID is required', 400)
  }
  if (!reviewerId) {
    throw new AppError('VALIDATION_ERROR', 'Reviewer ID is required', 400)
  }
  if (!orgId) {
    throw new AppError('VALIDATION_ERROR', 'Organization ID is required', 400)
  }

  const db = createTenantPrisma(orgId)

  const request = await db.deletionRequest.findFirst({
    where: { id: requestId },
  })

  if (!request) {
    throw new AppError('NOT_FOUND', 'Deletion request not found', 404)
  }

  if (request.status !== 'pending') {
    throw new AppError(
      'INVALID_STATE',
      `Cannot reject a request that is already ${request.status}`,
      400,
    )
  }

  const rejected = await db.deletionRequest.update({
    where: { id: requestId },
    data: {
      status: 'rejected',
      reviewedById: reviewerId,
      reviewedAt: new Date(),
    },
  })

  return rejected
}
