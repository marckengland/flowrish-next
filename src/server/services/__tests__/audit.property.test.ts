import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

/**
 * Property-based tests for the audit logging service.
 *
 * Properties tested:
 * 1. Every state mutation creates exactly one audit entry (metamorphic):
 *    for any successful `logAudit` call, exactly one `auditEntry.create`
 *    invocation is issued against the underlying store with a payload
 *    matching the inputs.
 * 2. Audit entries are append-only (invariant): the audit service exposes
 *    no update or delete operations. Once an entry is persisted, no
 *    subsequent operation through the service API can modify its fields.
 *
 * **Validates: Requirements 20.1, 20.2, 20.3**
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockDb = {
  auditEntry: {
    create: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
}

vi.mock('@/server/db/middleware', () => ({
  createTenantPrisma: vi.fn(() => mockDb),
  TENANT_SCOPED_MODELS: ['AuditEntry'],
}))

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: vi.fn(),
}))

import * as auditModule from '@/server/services/audit'
import { logAudit } from '@/server/services/audit'

// ─── Generators ──────────────────────────────────────────────────────────────

const uuidArb = fc.uuid()

/**
 * Every supported audit action that represents a state mutation or
 * security-sensitive event.
 */
const actionArb = fc.constantFrom(
  'CREATE',
  'UPDATE',
  'DELETE',
  'LOGIN',
  'LOGOUT',
  'EXPORT',
  'IMPORT',
) as fc.Arbitrary<auditModule.AuditActionType>

/**
 * Reasonable entity type names used across the app (Lead, Contact, Company,
 * Task, Activity, ...). We constrain to simple identifiers to avoid Zod/
 * sanitization interactions — the audit service itself does not validate
 * entity type strings.
 */
const entityTypeArb = fc.constantFrom(
  'Lead',
  'Contact',
  'Company',
  'Task',
  'Activity',
  'Cadence',
  'CadenceEnrollment',
  'EmailMessage',
  'FileAttachment',
  'Session',
)

/**
 * Optional metadata object: a small map of arbitrary JSON-safe values.
 * Models the `{ field: { old, new } }` shape produced on UPDATE as well
 * as free-form context used by other actions.
 */
const metadataArb = fc.option(
  fc.dictionary(
    fc.string({ minLength: 1, maxLength: 16 }),
    fc.oneof(
      fc.string({ maxLength: 32 }),
      fc.integer(),
      fc.boolean(),
      fc.record({
        old: fc.oneof(fc.string({ maxLength: 16 }), fc.integer(), fc.constant(null)),
        new: fc.oneof(fc.string({ maxLength: 16 }), fc.integer(), fc.constant(null)),
      }),
    ),
    { maxKeys: 5 },
  ),
  { nil: undefined },
)

/**
 * A single `logAudit` call's worth of inputs.
 */
const auditCallArb = fc.record({
  action: actionArb,
  entityType: entityTypeArb,
  entityId: uuidArb,
  userId: uuidArb,
  orgId: uuidArb,
  metadata: metadataArb,
})

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Audit Logging - Property Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Property: Every state mutation creates exactly one audit entry', () => {
    /**
     * **Validates: Requirements 20.1, 20.2**
     *
     * For any single successful `logAudit` invocation, the service issues
     * exactly one write to `auditEntry.create`. This is the metamorphic
     * property that ties each CUD (or security event) call to precisely
     * one persisted audit row.
     */
    it('a single logAudit call produces exactly one auditEntry.create invocation', async () => {
      await fc.assert(
        fc.asyncProperty(auditCallArb, async (call) => {
          vi.clearAllMocks()
          mockDb.auditEntry.create.mockResolvedValue({ id: 'audit-1' })

          await logAudit(
            call.action,
            call.entityType,
            call.entityId,
            call.userId,
            call.orgId,
            call.metadata ?? undefined,
          )

          expect(mockDb.auditEntry.create).toHaveBeenCalledTimes(1)
        }),
      )
    })

    /**
     * The persisted entry carries exactly the inputs provided: the same
     * userId, action, entityType, entityId, and metadata (stored as
     * `changes`, or `null` when metadata is absent).
     */
    it('the single audit entry persisted has the exact inputs', async () => {
      await fc.assert(
        fc.asyncProperty(auditCallArb, async (call) => {
          vi.clearAllMocks()
          mockDb.auditEntry.create.mockResolvedValue({ id: 'audit-1' })

          await logAudit(
            call.action,
            call.entityType,
            call.entityId,
            call.userId,
            call.orgId,
            call.metadata ?? undefined,
          )

          expect(mockDb.auditEntry.create).toHaveBeenCalledTimes(1)
          expect(mockDb.auditEntry.create).toHaveBeenCalledWith({
            data: {
              userId: call.userId,
              action: call.action,
              entityType: call.entityType,
              entityId: call.entityId,
              changes: call.metadata ?? null,
            },
          })
        }),
      )
    })

    /**
     * N sequential `logAudit` calls produce exactly N persisted entries —
     * no deduplication, no batching, no dropped writes.
     */
    it('N sequential logAudit calls produce exactly N auditEntry.create invocations', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(auditCallArb, { minLength: 1, maxLength: 15 }),
          async (calls) => {
            vi.clearAllMocks()
            const created: unknown[] = []
            mockDb.auditEntry.create.mockImplementation((args: { data: unknown }) => {
              created.push(args.data)
              return Promise.resolve({ id: `audit-${created.length}` })
            })

            for (const c of calls) {
              await logAudit(
                c.action,
                c.entityType,
                c.entityId,
                c.userId,
                c.orgId,
                c.metadata ?? undefined,
              )
            }

            expect(mockDb.auditEntry.create).toHaveBeenCalledTimes(calls.length)
            expect(created).toHaveLength(calls.length)
          },
        ),
      )
    })

    /**
     * A failed underlying write still counts as a single logAudit
     * invocation (the service swallows errors — Requirement 20.2 — but
     * must not retry or emit a duplicate create).
     */
    it('even when the underlying write fails, exactly one create attempt is made', async () => {
      await fc.assert(
        fc.asyncProperty(auditCallArb, async (call) => {
          vi.clearAllMocks()
          const consoleSpy = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {})

          mockDb.auditEntry.create.mockRejectedValue(new Error('DB down'))

          await logAudit(
            call.action,
            call.entityType,
            call.entityId,
            call.userId,
            call.orgId,
            call.metadata ?? undefined,
          )

          expect(mockDb.auditEntry.create).toHaveBeenCalledTimes(1)
          consoleSpy.mockRestore()
        }),
      )
    })
  })

  describe('Property: Audit entries are append-only (never modified)', () => {
    /**
     * **Validates: Requirements 20.3**
     *
     * The audit service exposes no mutation surface beyond append. No
     * update, delete, upsert, or similar operation exists — so no caller
     * can modify an existing entry through the service API.
     */
    it('the audit service module exports no update/delete mutation helpers', () => {
      const exportedNames = Object.keys(auditModule)

      const forbiddenVerbs = [
        /^update/i,
        /^delete/i,
        /^remove/i,
        /^patch/i,
        /^upsert/i,
        /^modify/i,
        /^edit/i,
        /^destroy/i,
      ]

      for (const name of exportedNames) {
        for (const verb of forbiddenVerbs) {
          expect(
            verb.test(name),
            `Audit service must not export mutation '${name}' matching ${verb}`,
          ).toBe(false)
        }
      }
    })

    /**
     * After an arbitrary sequence of logAudit calls, the underlying
     * `auditEntry` store is only ever touched via `create` — never via
     * `update`, `delete`, `updateMany`, `deleteMany`, or `upsert`.
     */
    it('no sequence of logAudit calls ever invokes an update/delete operation', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(auditCallArb, { minLength: 0, maxLength: 20 }),
          async (calls) => {
            vi.clearAllMocks()

            // Attach spies for every mutating operation to catch unexpected use.
            const updateSpy = vi.fn()
            const deleteSpy = vi.fn()
            const updateManySpy = vi.fn()
            const deleteManySpy = vi.fn()
            const upsertSpy = vi.fn()
            ;(mockDb.auditEntry as Record<string, unknown>).update = updateSpy
            ;(mockDb.auditEntry as Record<string, unknown>).delete = deleteSpy
            ;(mockDb.auditEntry as Record<string, unknown>).updateMany =
              updateManySpy
            ;(mockDb.auditEntry as Record<string, unknown>).deleteMany =
              deleteManySpy
            ;(mockDb.auditEntry as Record<string, unknown>).upsert = upsertSpy

            mockDb.auditEntry.create.mockResolvedValue({ id: 'audit-x' })

            for (const c of calls) {
              await logAudit(
                c.action,
                c.entityType,
                c.entityId,
                c.userId,
                c.orgId,
                c.metadata ?? undefined,
              )
            }

            expect(updateSpy).not.toHaveBeenCalled()
            expect(deleteSpy).not.toHaveBeenCalled()
            expect(updateManySpy).not.toHaveBeenCalled()
            expect(deleteManySpy).not.toHaveBeenCalled()
            expect(upsertSpy).not.toHaveBeenCalled()
            // And the only mutating call that *is* allowed matches the
            // call count exactly.
            expect(mockDb.auditEntry.create).toHaveBeenCalledTimes(calls.length)
          },
        ),
      )
    })

    /**
     * Data captured at create time matches the input exactly and is never
     * rewritten later: for any N calls, the sequence of `data` payloads
     * passed to `create` is identical to the sequence of inputs (append
     * semantics, no reorder, no mutation).
     */
    it('the persisted data payloads form a monotonic append log of the inputs', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(auditCallArb, { minLength: 1, maxLength: 10 }),
          async (calls) => {
            vi.clearAllMocks()
            const persisted: Array<Record<string, unknown>> = []
            mockDb.auditEntry.create.mockImplementation(
              (args: { data: Record<string, unknown> }) => {
                // Snapshot at write time — later code must not be able to
                // reach back and change this payload.
                persisted.push({ ...args.data })
                return Promise.resolve({ id: `audit-${persisted.length}` })
              },
            )

            for (const c of calls) {
              await logAudit(
                c.action,
                c.entityType,
                c.entityId,
                c.userId,
                c.orgId,
                c.metadata ?? undefined,
              )
            }

            expect(persisted).toHaveLength(calls.length)
            for (let i = 0; i < calls.length; i++) {
              expect(persisted[i]).toEqual({
                userId: calls[i].userId,
                action: calls[i].action,
                entityType: calls[i].entityType,
                entityId: calls[i].entityId,
                changes: calls[i].metadata ?? null,
              })
            }
          },
        ),
      )
    })
  })
})
