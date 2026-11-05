import { beforeEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
const m = vi.hoisted(() => ({ actor: vi.fn(), member: vi.fn(), members: vi.fn(), access: vi.fn(), lock: vi.fn(), leads: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), audit: vi.fn(), receipt: vi.fn(), cleanup: vi.fn(), count: vi.fn() }))
vi.mock('@/server/auth/permissions', () => ({ requirePermission: (user: { allowed: boolean }) => { if (!user.allowed) throw Object.assign(new Error('Denied'), { code: 'FORBIDDEN', statusCode: 403 }) } }))
vi.mock('@/server/services/access', () => ({ getLeadAccessFilter: m.access }))
vi.mock('@/server/db/client', () => {
  const db = { user: { findUnique: m.actor }, organizationMember: { findUnique: m.member, findMany: m.members }, lead: { findMany: m.leads, updateMany: m.update }, bulkLeadUpdate: { findFirst: m.get, create: m.create, update: m.receipt, deleteMany: m.cleanup, count: m.count }, auditEntry: { createMany: m.audit }, $queryRaw: m.lock }
  return { prisma: { ...db, $transaction: (action: (tx: unknown) => unknown) => action(db) } }
})
import { applyBulkLeadUpdate, previewBulkLeadUpdate, bulkLeadOptions } from '../bulk-lead-updates'
const id = '11111111-1111-4111-8111-111111111111', leadId = '22222222-2222-4222-8222-222222222222', ownerId = '33333333-3333-4333-8333-333333333333', time = new Date('2026-11-05T00:00:00.000Z')
const input = { id, leads: [{ id: leadId, expectedUpdatedAt: time.toISOString() }], change: { field: 'leadStatus', value: 'QUALIFIED' } }
const lead = { id: leadId, firstName: 'Practice', lastName: 'Prospect', updatedAt: time, assignedUserId: ownerId, leadStatus: 'NEW', assignedUser: { name: 'Practice owner', email: 'practice@example.invalid' } }
const record = () => ({ id, organizationId: 'org', userId: 'user', requestHash: '', change: input.change, snapshots: [{ id: leadId, expectedUpdatedAt: time.toISOString(), oldValue: 'NEW' }], targetHash: null, createdAt: new Date(), expiresAt: new Date(Date.now() + 600000), appliedAt: null, updatedCount: null, unchangedCount: null })
beforeEach(() => { vi.resetAllMocks(); m.actor.mockResolvedValue({ id: 'user', allowed: true, organizationMemberships: [{ organizationId: 'org' }], teamMemberships: [] }); m.member.mockResolvedValue({ id: 'member', user: { id: ownerId, name: 'Practice owner', email: 'practice@example.invalid' } }); m.members.mockResolvedValue([{ userId: ownerId, user: { id: ownerId, name: 'Practice owner', email: 'practice@example.invalid' } }]); m.access.mockResolvedValue({ deletedAt: null }); m.lock.mockResolvedValue([{ id: 'member' }]); m.leads.mockResolvedValue([lead]); m.get.mockResolvedValue(null); m.create.mockImplementation(async ({ data }: any) => data); m.update.mockResolvedValue({ count: 1 }); m.audit.mockResolvedValue({ count: 1 }); m.receipt.mockImplementation(async ({ data }: any) => ({ ...record(), ...data })); m.cleanup.mockResolvedValue({ count: 0 }); m.count.mockResolvedValue(0) })
it('uses current actor membership and read/write scope, including eligible owner scope', async () => {
  m.actor.mockResolvedValue(null); await expect(bulkLeadOptions('org', 'user')).rejects.toMatchObject({ statusCode: 403 }); expect(m.leads).not.toHaveBeenCalled()
  m.actor.mockResolvedValue({ id: 'user', allowed: true, organizationMemberships: [{ organizationId: 'org' }] }); m.access.mockResolvedValue({ assignedUserId: 'user', deletedAt: null }); await bulkLeadOptions('org', 'user'); expect(m.members).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org', userId: 'user' }) }))
})
it('previews exact accessible versions without changing leads or writing audit entries', async () => {
  const result = await previewBulkLeadUpdate('org', 'user', input); expect(result).toMatchObject({ state: 'preview', id, rows: [{ id: leadId, before: 'NEW', after: 'QUALIFIED' }] }); expect(m.update).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled(); expect(m.create.mock.calls[0][0].data).toMatchObject({ organizationId: 'org', userId: 'user' }); expect(JSON.stringify(m.create.mock.calls[0][0].data)).not.toMatch(/Practice|example.invalid/)
})
it('rejects missing, inaccessible, stale or excessive selections as a whole', async () => {
  m.leads.mockResolvedValue([]); await expect(previewBulkLeadUpdate('org', 'user', input)).rejects.toMatchObject({ statusCode: 409 }); m.leads.mockResolvedValue([{ ...lead, updatedAt: new Date(time.getTime() + 1) }]); await expect(previewBulkLeadUpdate('org', 'user', input)).rejects.toMatchObject({ statusCode: 409 }); expect(m.create).not.toHaveBeenCalled(); m.leads.mockResolvedValue([lead]); m.count.mockResolvedValue(20); await expect(previewBulkLeadUpdate('org', 'user', input)).rejects.toMatchObject({ statusCode: 429 })
})
it('commits only the reviewed field with transactional audit and a count-only receipt', async () => {
  m.get.mockResolvedValue(record()); const result = await applyBulkLeadUpdate('org', 'user', { id, confirmed: true }); expect(result).toMatchObject({ state: 'applied', id, updated: 1, unchanged: 0 }); expect(result).not.toHaveProperty('rows'); const args = m.update.mock.calls[0][0]; expect(args.where).toMatchObject({ organizationId: 'org', deletedAt: null }); expect(args.data).toMatchObject({ leadStatus: 'QUALIFIED', updatedAt: expect.any(Date) }); expect(Object.keys(args.data).sort()).toEqual(['leadStatus', 'updatedAt']); expect(m.audit).toHaveBeenCalledWith({ data: [expect.objectContaining({ organizationId: 'org', userId: 'user', entityId: leadId, action: 'UPDATE', changes: expect.objectContaining({ leadStatus: { old: 'NEW', new: 'QUALIFIED' }, bulkRequestId: id }) })] }); expect(m.receipt.mock.calls[0][0].data.snapshots).toEqual([])
})
it('rejects expiry, stale source or conditional update loss before persisting a result', async () => {
  m.get.mockResolvedValue({ ...record(), expiresAt: new Date(0) }); await expect(applyBulkLeadUpdate('org', 'user', { id, confirmed: true })).rejects.toMatchObject({ statusCode: 410 }); expect(m.update).not.toHaveBeenCalled(); m.get.mockResolvedValue(record()); m.leads.mockResolvedValue([{ ...lead, updatedAt: new Date(time.getTime() + 1) }]); await expect(applyBulkLeadUpdate('org', 'user', { id, confirmed: true })).rejects.toMatchObject({ statusCode: 409 }); expect(m.update).not.toHaveBeenCalled(); m.leads.mockResolvedValue([lead]); m.update.mockResolvedValue({ count: 0 }); await expect(applyBulkLeadUpdate('org', 'user', { id, confirmed: true })).rejects.toMatchObject({ statusCode: 409 }); expect(m.audit).not.toHaveBeenCalled(); expect(m.receipt).not.toHaveBeenCalled()
})
it('replays completed receipts without another lead update even after preview expiry', async () => {
  m.get.mockResolvedValue({ ...record(), appliedAt: time, updatedCount: 1, unchangedCount: 0, snapshots: [], expiresAt: new Date(0) }); await expect(applyBulkLeadUpdate('org', 'user', { id, confirmed: true })).resolves.toMatchObject({ updated: 1 }); expect(m.update).not.toHaveBeenCalled(); expect(m.leads).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled()
})
it('preserves no-op rows and stops before the receipt if auditing fails', async () => {
  m.get.mockResolvedValue(record()); m.leads.mockResolvedValue([{ ...lead, leadStatus: 'QUALIFIED' }]); await expect(applyBulkLeadUpdate('org', 'user', { id, confirmed: true })).rejects.toMatchObject({ statusCode: 409 }); m.get.mockResolvedValue({ ...record(), snapshots: [{ id: leadId, expectedUpdatedAt: time.toISOString(), oldValue: 'QUALIFIED' }] }); await expect(applyBulkLeadUpdate('org', 'user', { id, confirmed: true })).resolves.toMatchObject({ updated: 0, unchanged: 1 }); expect(m.update).not.toHaveBeenCalled(); m.receipt.mockClear(); m.get.mockResolvedValue(record()); m.leads.mockResolvedValue([lead]); m.audit.mockRejectedValue(new Error('private SQL password')); await expect(applyBulkLeadUpdate('org', 'user', { id, confirmed: true })).rejects.toMatchObject({ statusCode: 503 }); expect(m.receipt).not.toHaveBeenCalled()
})
it('rechecks current authorization after waiting for lead locks', async () => {
  m.get.mockResolvedValue(record()); m.actor.mockResolvedValueOnce({ id: 'user', allowed: true, organizationMemberships: [{ organizationId: 'org' }], teamMemberships: [] }).mockResolvedValueOnce(null)
  await expect(applyBulkLeadUpdate('org', 'user', { id, confirmed: true })).rejects.toMatchObject({ statusCode: 403 }); expect(m.update).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled(); expect(m.receipt).not.toHaveBeenCalled()
})
it('applies an eligible owner without changing another field, and rejects a changed target identity', async () => {
  const targetHash = createHash('sha256').update(JSON.stringify({ id: ownerId, label: 'Practice owner (practice@example.invalid)' })).digest('hex')
  m.get.mockResolvedValue({ ...record(), change: { field: 'assignedUserId', value: ownerId }, targetHash, snapshots: [{ id: leadId, expectedUpdatedAt: time.toISOString(), oldValue: null }] }); m.leads.mockResolvedValue([{ ...lead, assignedUserId: null, assignedUser: null }])
  await expect(applyBulkLeadUpdate('org', 'user', { id, confirmed: true })).resolves.toMatchObject({ updated: 1 }); expect(m.update.mock.calls[0][0].data).toEqual({ assignedUserId: ownerId, updatedAt: expect.any(Date) }); expect(m.audit.mock.calls[0][0].data[0].changes.assignedUserId).toEqual({ old: null, new: ownerId })
  m.update.mockClear(); m.member.mockResolvedValue({ id: 'member', user: { id: ownerId, name: 'Renamed owner', email: 'practice@example.invalid' } }); await expect(applyBulkLeadUpdate('org', 'user', { id, confirmed: true })).rejects.toMatchObject({ statusCode: 409 }); expect(m.update).not.toHaveBeenCalled()
})
it('rejects foreign owner scope before storing a preview and never exposes foreign receipts', async () => {
  m.access.mockResolvedValue({ deletedAt: null, assignedUserId: 'user' }); await expect(previewBulkLeadUpdate('org', 'user', { ...input, change: { field: 'assignedUserId', value: ownerId } })).rejects.toMatchObject({ statusCode: 403 }); expect(m.create).not.toHaveBeenCalled()
  await expect(applyBulkLeadUpdate('org', 'user', { id, confirmed: true })).rejects.toMatchObject({ statusCode: 404 }); expect(m.get).toHaveBeenCalledWith({ where: { id, organizationId: 'org', userId: 'user' } }); expect(m.update).not.toHaveBeenCalled()
})
it('rejects a preview that expires while waiting for row locks', async () => {
  vi.useFakeTimers()
  try {
    m.get.mockResolvedValue(record()); m.lock.mockResolvedValueOnce([{ id: 'member' }]).mockResolvedValueOnce([{ id }]).mockImplementationOnce(async () => { vi.advanceTimersByTime(600001); return [{ id: leadId }] })
    await expect(applyBulkLeadUpdate('org', 'user', { id, confirmed: true })).rejects.toMatchObject({ statusCode: 410 }); expect(m.update).not.toHaveBeenCalled(); expect(m.receipt).not.toHaveBeenCalled()
  } finally { vi.useRealTimers() }
})
