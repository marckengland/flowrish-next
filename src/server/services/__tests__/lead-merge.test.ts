import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ actor: vi.fn(), member: vi.fn(), access: vi.fn(), rows: vi.fn(), aliases: vi.fn(), get: vi.fn(), create: vi.fn(), receipt: vi.fn(), cleanup: vi.fn(), count: vi.fn(), raw: vi.fn(), update: vi.fn(), audit: vi.fn(), related: {} as Record<string, unknown[]>, transfer: vi.fn() }))
vi.mock('@/server/services/access', () => ({ getLeadAccessFilter: m.access }))
vi.mock('@/server/services/lead-merge-transfer', () => ({ transferMergeRecords: m.transfer }))
vi.mock('@/server/db/client', () => {
  const db = { user: { findUnique: m.actor }, organizationMember: { findUnique: m.member }, lead: { findMany: m.rows, count: m.aliases, updateMany: m.update }, leadMergeReview: { findFirst: m.get, create: m.create, update: m.receipt, count: m.count, deleteMany: m.cleanup }, auditEntry: { createMany: m.audit }, $queryRaw: m.raw }
  return { prisma: { ...db, $transaction: (action: (tx: unknown) => unknown) => action(db) } }
})
import { previewLeadMerge, applyLeadMerge } from '../lead-merge'
const id = '11111111-1111-4111-8111-111111111111', primaryId = '22222222-2222-4222-8222-222222222222', secondaryId = '33333333-3333-4333-8333-333333333333', stamp = new Date('2026-11-05T00:00:00.000Z')
const input = { id, primaryId, secondaryId }
const actor = () => ({ id: 'user', organizationMemberships: [{ organizationId: 'org' }], teamMemberships: [{ role: { hierarchy: 0, permissions: ['leads:read', 'leads:write', 'leads:delete'].map(key => ({ key })) } }] })
const leads = () => [primaryId, secondaryId].map((id, index) => ({ id, firstName: index ? 'Secondary' : 'Primary', lastName: 'Practice', email: 'practice@example.invalid', organizationId: 'org', updatedAt: stamp, deletedAt: null, mergedIntoId: null, assignedUserId: 'user', score: 10, leadStatus: 'NEW', stageId: 'stage', assignedUser: { name: 'Practice owner', email: 'owner@example.invalid' }, stage: { name: 'New' } }))
beforeEach(() => {
  vi.resetAllMocks(); m.related = {}; m.actor.mockResolvedValue(actor()); m.member.mockResolvedValue({ id: 'member' }); m.access.mockResolvedValue({ deletedAt: null }); m.rows.mockResolvedValue(leads()); m.aliases.mockResolvedValue(0); m.get.mockResolvedValue(null); m.count.mockResolvedValue(0); m.cleanup.mockResolvedValue({ count: 0 }); m.create.mockImplementation(async ({ data }: any) => ({ ...data, createdAt: stamp, appliedAt: null })); m.update.mockResolvedValue({ count: 1 }); m.audit.mockResolvedValue({ count: 2 }); m.receipt.mockImplementation(async ({ data }: any) => ({ id, ...data })); m.transfer.mockResolvedValue({ counts: { Activity: 0, Task: 0, StageTransition: 0, ScoreHistory: 0, LeadContact: 0 }, copiedContacts: [] })
  m.raw.mockImplementation(async (query: any) => { const sql = Array.isArray(query) ? query.join('?') : query.sql; const table = /FROM "([^"]+)" r/.exec(sql)?.[1]; if (table === 'Lead') return [{ id: primaryId, hash: 'a'.repeat(64) }, { id: secondaryId, hash: 'b'.repeat(64) }]; return table ? m.related[table] ?? [] : [{ id: 'member' }] })
})
async function reviewed() { await previewLeadMerge('org', 'user', input); const record = m.create.mock.calls.at(-1)![0].data; m.get.mockResolvedValue(record); return record }
it('previews both scoped leads and exact keeper fields without business writes or stored names/emails', async () => {
  const result = await previewLeadMerge('org', 'user', input); expect(result).toMatchObject({ state: 'preview', id, primaryId, secondaryId, blockers: [] }); if (result.state !== 'preview') throw new Error('Expected a fresh preview'); expect(result.fields.some(field => field.key === 'email')).toBe(true); expect(m.rows.mock.calls[0][0].where).toMatchObject({ organizationId: 'org', deletedAt: null }); expect(JSON.stringify(m.create.mock.calls[0][0].data)).not.toMatch(/Practice|example.invalid/); expect(m.update).not.toHaveBeenCalled(); expect(m.transfer).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled()
})
it('blocks unsupported workflow links and prior merged sources, even when record versions are unchanged', async () => {
  m.related.CallbackCrmHandoff = [{ id: 'callback', leadId: secondaryId, hash: 'a'.repeat(64), organizationId: 'org' }]; const review = await reviewed(); expect(review).toHaveProperty('fingerprint'); await expect(applyLeadMerge('org', 'user', { id, confirmed: true })).rejects.toMatchObject({ statusCode: 409 }); expect(m.transfer).not.toHaveBeenCalled()
})
it('rejects stale lead fields, added linked rows, missing records and missing delete permission before any transfer', async () => {
  await reviewed(); m.rows.mockResolvedValue([{ ...leads()[0], score: 11 }, leads()[1]]); await expect(applyLeadMerge('org', 'user', { id, confirmed: true })).rejects.toMatchObject({ statusCode: 409 }); m.rows.mockResolvedValue(leads()); m.related.Task = [{ id: 'task', leadId: secondaryId, hash: 'a'.repeat(64), organizationId: 'org' }]; await expect(applyLeadMerge('org', 'user', { id, confirmed: true })).rejects.toMatchObject({ statusCode: 409 }); m.rows.mockResolvedValue([]); await expect(applyLeadMerge('org', 'user', { id, confirmed: true })).rejects.toMatchObject({ statusCode: 404 }); m.actor.mockResolvedValue({ ...actor(), teamMemberships: [] }); await expect(applyLeadMerge('org', 'user', { id, confirmed: true })).rejects.toMatchObject({ statusCode: 403 }); expect(m.transfer).not.toHaveBeenCalled()
})
it('archives conditionally, retains primary fields, and commits transfer/audit/count receipt together', async () => {
  await reviewed(); const result = await applyLeadMerge('org', 'user', { id, confirmed: true }); expect(result).toMatchObject({ state: 'applied', id, primaryId, secondaryId }); expect(m.transfer).toHaveBeenCalledOnce(); expect(m.update.mock.calls).toHaveLength(2); const changes = m.update.mock.calls.map(call => call[0].data); expect(changes).toContainEqual({ updatedAt: expect.any(Date) }); expect(changes).toContainEqual({ mergedIntoId: primaryId, deletedAt: expect.any(Date), updatedAt: expect.any(Date) }); expect(m.audit.mock.calls[0][0].data).toHaveLength(2); expect(m.receipt).toHaveBeenCalledOnce()
})
it('replays a completed receipt after expiry without another transfer', async () => {
  await reviewed(); const result = await applyLeadMerge('org', 'user', { id, confirmed: true }); m.get.mockResolvedValue({ id, primaryId, secondaryId, appliedAt: stamp, expiresAt: new Date(0), result }); m.transfer.mockClear(); m.update.mockClear(); m.audit.mockClear(); await expect(applyLeadMerge('org', 'user', { id, confirmed: true })).resolves.toEqual(result); expect(m.transfer).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled()
})
it('rejects expiry and changed authorization after lock waits, and rolls back an audit failure without a receipt', async () => {
  const record = await reviewed(); m.get.mockResolvedValue({ ...record, expiresAt: new Date(0) }); await expect(applyLeadMerge('org', 'user', { id, confirmed: true })).rejects.toMatchObject({ statusCode: 410 }); m.get.mockResolvedValue(record); m.actor.mockResolvedValueOnce(actor()).mockResolvedValueOnce(null); await expect(applyLeadMerge('org', 'user', { id, confirmed: true })).rejects.toMatchObject({ statusCode: 403 }); expect(m.transfer).not.toHaveBeenCalled(); m.actor.mockResolvedValue(actor()); m.audit.mockRejectedValue(new Error('private database detail')); await expect(applyLeadMerge('org', 'user', { id, confirmed: true })).rejects.toMatchObject({ statusCode: 503 }); expect(m.receipt).not.toHaveBeenCalled()
})
it('does not reapply or report success for an operator-undone merge', async () => {
  m.get.mockResolvedValue({ id, primaryId, secondaryId, appliedAt: stamp, manifest: { undoneAt: stamp.toISOString() }, result: { state: 'applied', id, primaryId, secondaryId, counts: { Activity: 0, Task: 0, StageTransition: 0, ScoreHistory: 0, LeadContact: 0 }, appliedAt: stamp.toISOString() } })
  await expect(applyLeadMerge('org', 'user', { id, confirmed: true })).rejects.toMatchObject({ code: 'MERGE_UNDONE', statusCode: 409 }); expect(m.transfer).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled()
})
it('rejects a review that expires while its lead lock is waiting', async () => {
  vi.useFakeTimers()
  try {
    await reviewed(); m.raw.mockImplementation(async (query: any) => { const sql = Array.isArray(query) ? query.join('?') : query.sql; if (sql.includes('FROM "Lead"') && sql.includes('ORDER BY id FOR UPDATE')) vi.advanceTimersByTime(600001); return sql.includes('FROM "OrganizationMember"') ? [{ id: 'member' }] : [] })
    await expect(applyLeadMerge('org', 'user', { id, confirmed: true })).rejects.toMatchObject({ statusCode: 410 }); expect(m.transfer).not.toHaveBeenCalled()
  } finally { vi.useRealTimers() }
})
it('caps pending reviews and linked work and blocks prior merged sources', async () => {
  m.count.mockResolvedValue(20); await expect(previewLeadMerge('org', 'user', input)).rejects.toMatchObject({ statusCode: 429 }); expect(m.create).not.toHaveBeenCalled(); m.count.mockResolvedValue(0); m.related.Task = Array.from({ length: 501 }, (_, index) => ({ id: String(index), leadId: secondaryId, organizationId: 'org', hash: 'a'.repeat(64) })); await expect(previewLeadMerge('org', 'user', input)).rejects.toMatchObject({ statusCode: 413 }); m.related = {}; m.aliases.mockResolvedValue(1); const value = await previewLeadMerge('org', 'user', input); expect(value).toMatchObject({ state: 'preview', blockers: [expect.stringContaining('earlier merged records')] })
})
