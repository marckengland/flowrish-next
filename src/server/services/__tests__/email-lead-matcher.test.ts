import { beforeEach, expect, it, vi } from 'vitest'
import type { Prisma } from '@prisma/client'
import { matchEmailLead, lockEmailMatch } from '../email-lead-matcher'
const findMany = vi.fn(), raw = vi.fn(), db = { lead: { findMany }, $queryRaw: raw } as unknown as Prisma.TransactionClient
const lead = (id: string, mergedIntoId: string | null = null) => ({ id, firstName: id, lastName: 'Practice', email: 'alias@example.invalid', altEmail: null, assignedUserId: 'owner', mergedIntoId, deletedAt: mergedIntoId ? new Date() : null, updatedAt: new Date('2026-11-05T00:00:00.000Z') })
beforeEach(() => { vi.resetAllMocks(); raw.mockResolvedValue([]) })
it('collapses direct and multiple archived addresses onto one active retained lead', async () => {
  findMany.mockResolvedValueOnce([lead('keep'), lead('old1', 'keep'), lead('old2', 'keep')]).mockResolvedValueOnce([lead('keep')])
  const match = await matchEmailLead(db, 'org', ' Alias@Example.Invalid '); expect(match.targets.map(row => row.id)).toEqual(['keep']); expect(match.blocked).toBe(false); expect(findMany.mock.calls[0][0].where.organizationId).toBe('org'); expect(JSON.stringify(findMany.mock.calls[0][0])).toContain('alias@example.invalid'); expect(findMany.mock.calls[1][0].where).toMatchObject({ organizationId: 'org', deletedAt: null, mergedIntoId: null })
})
it('holds collisions between an active address and another retained archive target', async () => {
  findMany.mockResolvedValueOnce([lead('other'), lead('old', 'keep')]).mockResolvedValueOnce([lead('keep'), lead('other')]); const match = await matchEmailLead(db, 'org', 'alias@example.invalid'); expect(match.targets).toHaveLength(2); expect(match.reason).toBe('AMBIGUOUS')
})
it('fails closed for missing/deleted/foreign/chained targets and bounded-source overflow', async () => {
  findMany.mockResolvedValueOnce([lead('old', 'missing')]).mockResolvedValueOnce([]); expect((await matchEmailLead(db, 'org', 'alias@example.invalid')).reason).toBe('UNAVAILABLE')
  findMany.mockResolvedValueOnce(Array.from({ length: 201 }, (_, i) => lead(`old-${i}`, 'keep'))).mockResolvedValueOnce([lead('keep')]); expect((await matchEmailLead(db, 'org', 'alias@example.invalid')).reason).toBe('LIMIT')
})
it('rejects changed matches after locks instead of routing a stale source', async () => {
  const first = { sources: [lead('old', 'keep')], targets: [lead('keep')], blocked: false, reason: null }
  findMany.mockResolvedValueOnce([lead('old', 'different')]).mockResolvedValueOnce([lead('different')]); await expect(lockEmailMatch(db, 'org', 'alias@example.invalid', first)).rejects.toMatchObject({ statusCode: 409 }); expect(raw).toHaveBeenCalledOnce()
})
