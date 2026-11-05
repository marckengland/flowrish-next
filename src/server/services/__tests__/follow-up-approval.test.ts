import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ db: { user: { findUnique: vi.fn() }, lead: { findFirst: vi.fn() }, task: { findFirst: vi.fn(), create: vi.fn() }, followUpSuggestion: { findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn() }, followUpSnooze: { findUnique: vi.fn() }, auditEntry: { findFirst: vi.fn(), create: vi.fn() }, $queryRaw: vi.fn() }, tx: vi.fn() }))
vi.mock('@/server/db/client', () => ({ prisma: { $transaction: m.tx } }))
import { previewFollowUpApproval, approveFollowUp, readFollowUpApproval } from '../follow-up-approval'
const requestId = '11111111-1111-4111-8111-111111111111'
const row = { id: 'item', organizationId: 'org', assigneeId: 'actor', leadId: 'lead', taskId: null as string | null, status: 'PENDING', sourceType: 'EMAIL', sourceId: 'message', sourceKey: 'message-key', sourceThreadId: 'thread', title: 'Call clinic', description: 'Notes', sourceText: 'Private email source', updatedAt: new Date('2026-11-06T00:00:00Z') }
let current: typeof row, savedTask: { id: string; assigneeId: string; leadId: string; title: string; description: string; dueDate: Date; updatedAt: Date; isComplete: boolean } | null, savedAudit: { changes: unknown } | null
const user = (write = true) => ({ id: 'actor', organizationMemberships: [{ organizationId: 'org' }], teamMemberships: [{ teamId: 'team', team: { organizationId: 'org' }, role: { hierarchy: 3, permissions: [{ key: 'leads:read' }, ...(write ? [{ key: 'leads:write' }] : [])] } }] })
beforeEach(() => {
 vi.resetAllMocks(); current = { ...row }; savedTask = null; savedAudit = null
 m.tx.mockImplementation(run => run(m.db)); m.db.$queryRaw.mockResolvedValue([{ id: 'member' }]); m.db.user.findUnique.mockResolvedValue(user()); m.db.lead.findFirst.mockResolvedValue({ id: 'lead', firstName: 'Practice', lastName: 'Clinic', email: 'lead@example.invalid' }); m.db.followUpSuggestion.findFirst.mockImplementation(async () => current); m.db.followUpSnooze.findUnique.mockResolvedValue(null); m.db.task.findFirst.mockImplementation(async () => savedTask); m.db.auditEntry.findFirst.mockImplementation(async () => savedAudit)
 m.db.followUpSuggestion.updateMany.mockImplementation(async ({ data }) => { current = { ...current, ...data }; return { count: 1 } }); m.db.followUpSuggestion.update.mockImplementation(async ({ data }) => { current = { ...current, ...data }; return current })
 m.db.task.create.mockImplementation(async ({ data }) => { savedTask = { ...data, id: 'new-task', updatedAt: new Date('2026-11-06T00:00:00Z'), isComplete: false }; return savedTask }); m.db.auditEntry.create.mockImplementation(async ({ data }) => { savedAudit = data; return data })
})
async function input() { const preview = await previewFollowUpApproval('org', 'actor', 'item'); return { requestId, expectedVersion: preview.version, assigneeId: 'actor', title: 'Reviewed task', description: 'Reviewed notes', dueDate: '2026-11-08T01:00:00.000Z' } }
it('previews only authorized task fields and performs no writes or provider work', async () => {
 const result = await previewFollowUpApproval('org', 'actor', 'item'); expect(result).toMatchObject({ id: 'item', existingTask: null, title: 'Call clinic', assigneeId: 'actor', leadName: 'Practice Clinic', version: expect.stringMatching(/^[a-f0-9]{64}$/) }); expect(JSON.stringify(result)).not.toContain('Private email source'); expect(m.db.task.create).not.toHaveBeenCalled(); expect(m.db.auditEntry.create).not.toHaveBeenCalled()
})
it('approves once and records an exact request receipt; identical replay and GET create no extra task', async () => {
 const values = await input(), result = await approveFollowUp('org', 'actor', 'item', values)
 expect(result).toMatchObject({ state: 'confirmed', requestId, id: 'item', task: { id: 'new-task', title: 'Reviewed task', assigneeId: 'actor', dueDate: values.dueDate } }); expect(m.db.auditEntry.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ id: requestId, organizationId: 'org', userId: 'actor', entityId: 'item' }) }))
 await approveFollowUp('org', 'actor', 'item', values); await readFollowUpApproval('org', 'actor', 'item', requestId); expect(m.db.task.create).toHaveBeenCalledTimes(1); expect(m.db.auditEntry.create).toHaveBeenCalledTimes(1)
 await expect(approveFollowUp('org', 'actor', 'item', { ...values, title: 'Reused request' })).rejects.toMatchObject({ statusCode: 409 })
})
it('rejects changed sources, wrong owners and already-reviewed items before creating work', async () => {
 const values = await input(); current = { ...current, updatedAt: new Date('2026-11-07T00:00:00Z') }; await expect(approveFollowUp('org', 'actor', 'item', values)).rejects.toMatchObject({ statusCode: 409 }); current = { ...row }; await expect(approveFollowUp('org', 'actor', 'item', { ...values, assigneeId: 'other' })).rejects.toMatchObject({ statusCode: 409 }); current.status = 'APPROVED'; await expect(approveFollowUp('org', 'actor', 'item', values)).rejects.toMatchObject({ statusCode: 409 }); expect(m.db.task.create).not.toHaveBeenCalled()
})
it('reuses callback work without changing deadlines and rejects callback edits or stale task versions', async () => {
 current = { ...row, sourceType: 'CALL', taskId: 'existing' }; savedTask = { id: 'existing', assigneeId: 'actor', leadId: 'lead', title: 'Existing callback', description: 'Callback notes', dueDate: new Date('2026-11-09T02:00:00Z'), updatedAt: new Date('2026-11-06T00:00:00Z'), isComplete: false }
 const preview = await previewFollowUpApproval('org', 'actor', 'item'), values = { requestId, expectedVersion: preview.version, ...preview.existingTask! }; delete (values as { id?: string }).id
 await expect(approveFollowUp('org', 'actor', 'item', { ...values, dueDate: '2026-11-10T02:00:00.000Z' })).rejects.toMatchObject({ statusCode: 409 }); const before = { ...savedTask }; expect((await approveFollowUp('org', 'actor', 'item', values)).state).toBe('confirmed'); expect(savedTask).toEqual(before); expect(m.db.task.create).not.toHaveBeenCalled()
})
it('reports changed or absent receipts without re-approving or leaking another scope', async () => {
 expect(await readFollowUpApproval('org', 'actor', 'item', requestId)).toEqual({ id: 'item', requestId, state: 'not-recorded', task: null }); const values = await input(); await approveFollowUp('org', 'actor', 'item', values); savedTask!.dueDate = new Date('2026-11-10T00:00:00Z'); expect((await readFollowUpApproval('org', 'actor', 'item', requestId)).state).toBe('changed'); expect(m.db.task.create).toHaveBeenCalledTimes(1)
 m.db.lead.findFirst.mockResolvedValue(null); await expect(readFollowUpApproval('other', 'actor', 'item', requestId)).rejects.toMatchObject({ statusCode: 403 }); expect(m.db.auditEntry.findFirst.mock.calls[0][0].where).toMatchObject({ id: requestId, organizationId: 'org', userId: 'actor', entityId: 'item' })
})
it('denies revoked permissions and reassigned/completed callback tasks before approval', async () => {
 m.db.user.findUnique.mockResolvedValue(user(false)); await expect(previewFollowUpApproval('org', 'actor', 'item')).rejects.toMatchObject({ statusCode: 403 }); m.db.user.findUnique.mockResolvedValue(user()); current = { ...row, sourceType: 'CALL', taskId: 'missing-task' }; await expect(previewFollowUpApproval('org', 'actor', 'item')).rejects.toMatchObject({ statusCode: 404 }); expect(m.db.task.create).not.toHaveBeenCalled()
})
