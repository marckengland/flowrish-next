import { createTenantPrisma } from '@/server/db/middleware'

/**
 * Audit Logging Service
 *
 * Records immutable audit entries for create/update/delete operations and
 * other security-sensitive events (login, logout, export, import).
 *
 * Logging is intentionally non-blocking: callers invoke `logAudit` in
 * fire-and-forget fashion so that audit failures never block the primary
 * operation. Any error is logged to the console but swallowed.
 *
 * Audit entries are immutable by design — this service exposes no update
 * or delete operations.
 *
 * Validates: Requirements 20.1, 20.2, 20.3, 20.4
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Supported audit actions. Matches the Prisma `AuditAction` enum.
 */
export type AuditActionType =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'LOGIN'
  | 'LOGOUT'
  | 'EXPORT'
  | 'IMPORT'

/**
 * Optional metadata recorded with an audit entry.
 *
 * For `UPDATE` actions this typically contains a diff of changed fields
 * in the shape `{ field: { old: value, new: value } }`. For other actions
 * it can carry arbitrary context (e.g. IP address on LOGIN, filter criteria
 * on EXPORT).
 */
export type AuditMetadata = Record<string, unknown>

/**
 * Filters accepted by `getAuditLog`.
 */
export interface AuditLogFilters {
  entityType?: string
  userId?: string
  action?: AuditActionType
  /**
   * Inclusive lower bound on `createdAt`.
   */
  fromDate?: Date
  /**
   * Exclusive upper bound on `createdAt`.
   */
  toDate?: Date
}

export interface AuditLogPagination {
  page?: number
  pageSize?: number
}

export interface AuditLogResult {
  entries: Array<{
    id: string
    userId: string
    action: AuditActionType
    entityType: string
    entityId: string
    changes: unknown
    organizationId: string
    createdAt: Date
  }>
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

// ─── Service Functions ───────────────────────────────────────────────────────

/**
 * Records an audit entry asynchronously, without blocking the caller.
 *
 * The write is issued through the tenant-scoped Prisma client so that
 * `organizationId` is injected automatically. Errors are logged to the
 * console and never rethrown — audit logging must never break the primary
 * operation.
 *
 * The returned promise resolves once the entry has been persisted (or the
 * write has failed). Callers are free to `await` it when they want to
 * synchronize on completion (e.g. tests), or drop it for fire-and-forget
 * behavior in normal request flow.
 *
 * Validates: Requirements 20.1, 20.2
 */
export async function logAudit(
  action: AuditActionType,
  entityType: string,
  entityId: string,
  userId: string,
  orgId: string,
  metadata?: AuditMetadata,
): Promise<void> {
  try {
    const db = createTenantPrisma(orgId)
    await db.auditEntry.create({
      data: {
        userId,
        action,
        entityType,
        entityId,
        changes: metadata ?? null,
      } as never,
    })
  } catch (err) {
    // Audit failure must never block the primary operation.
    console.error('Audit log failed:', {
      action,
      entityType,
      entityId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * Retrieves audit entries for an organization with optional filters and
 * pagination.
 *
 * Results are ordered by `createdAt` descending (newest first). Pagination
 * defaults to `page=1`, `pageSize=50` and is capped at `pageSize=200` to
 * avoid runaway result sets.
 *
 * Validates: Requirements 20.3
 */
export async function getAuditLog(
  orgId: string,
  filters: AuditLogFilters = {},
  pagination: AuditLogPagination = {},
): Promise<AuditLogResult> {
  const db = createTenantPrisma(orgId)

  const page = Math.max(1, pagination.page ?? 1)
  const pageSize = Math.min(200, Math.max(1, pagination.pageSize ?? 50))
  const skip = (page - 1) * pageSize

  const where: Record<string, unknown> = {}

  if (filters.entityType) {
    where.entityType = filters.entityType
  }

  if (filters.userId) {
    where.userId = filters.userId
  }

  if (filters.action) {
    where.action = filters.action
  }

  if (filters.fromDate || filters.toDate) {
    const createdAt: Record<string, Date> = {}
    if (filters.fromDate) createdAt.gte = filters.fromDate
    if (filters.toDate) createdAt.lt = filters.toDate
    where.createdAt = createdAt
  }

  const [entries, total] = await Promise.all([
    db.auditEntry.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    db.auditEntry.count({ where }),
  ])

  return {
    entries: entries as AuditLogResult['entries'],
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  }
}
