import { beforeEach, expect, it, vi } from 'vitest'
import type { Task } from '@prisma/client'
const m = vi.hoisted(() => ({ db: { $queryRaw: vi.fn(), user: { findUnique: vi.fn() }, lead: { findFirst: vi.fn(), update: vi.fn() }, task: { findFirst: vi.fn(), update: vi.fn() }, followUpSuggestion: { findFirst: vi.fn() }, activity: { create: vi.fn() }, auditEntry: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() } }, team: { findMany: vi.fn() }, teamMember: { findMany: vi.fn() }, tx: vi.fn(), enabled: vi.fn() }))
vi.mock('@/server/db/client', () => ({ prisma: { $transaction: m.tx, team: m.team, teamMember: m.teamMember } }))
vi.mock('../follow-up-policy', () => ({ followUpWritesEnabled: m.enabled }))
import { listTaskHistory } from '../follow-up-task-history'
const requestId = '11111111-1111-4111-8111-111111111111'
const user = (write = true, hierarchy = 3) => ({ id: 'actor', organizationMemberships: [{ organizationId: 'org' }], teamMemberships: [{ teamId: 'team', team: { organizationId: 'org' }, role: { hierarchy, permissions: [{ key: 'leads:read' }, ...(write ? [{ key: 'leads:write' }] : [])] } }] })
let row: { id: string; organizationId: string; assigneeId: string; leadId: string; taskId: string | null; status: string; updatedAt: Date }
let task: Task & { assignee: { name: string } }, audit: { changes: unknown } | null
beforeEach(() => {
 vi.resetAllMocks(); m.enabled.mockReturnValue(true)
 m.team.findMany.mockResolvedValue([]); m.teamMember.findMany.mockImplementation(async ({ where }) => where.userId ? [{ teamId: 'team', team: { id: 'team' }, role: { hierarchy: 2 } }] : [{ userId: 'actor' }, { userId: 'colleague' }])
 row = { id: 'item', organizationId: 'org', assigneeId: 'actor', leadId: 'lead', taskId: 'task', status: 'APPROVED', updatedAt: new Date('2026-11-06T00:00:00Z') }
 task = { id: 'task', organizationId: 'org', leadId: 'lead', assigneeId: 'actor', title: 'Call Practice Clinic', description: 'Confirm their requirements', priority: 'MEDIUM', dueDate: new Date('2026-11-07T01:00:00Z'), createdAt: new Date('2026-11-06T00:00:00Z'), updatedAt: new Date('2026-11-06T00:00:00Z'), isComplete: false, completedAt: null, assignee: { name: 'Practice Owner' } }
 audit = null; m.tx.mockImplementation(run => run(m.db)); m.db.$queryRaw.mockResolvedValue([{ id: 'member' }]); m.db.user.findUnique.mockResolvedValue(user()); m.db.followUpSuggestion.findFirst.mockImplementation(async ({ where }) => row.organizationId === where.organizationId && row.assigneeId === where.assigneeId ? row : null)
 m.db.lead.findFirst.mockResolvedValue({ id: 'lead', firstName: 'Practice', lastName: 'Clinic' })
 m.db.task.findFirst.mockImplementation(async ({ where }) => task.id === where.id && task.organizationId === where.organizationId && task.leadId === where.leadId && (!where.assigneeId || task.assigneeId === where.assigneeId) ? task : null)
 m.db.task.update.mockImplementation(async ({ data }) => { task = { ...task, ...data, updatedAt: new Date('2026-11-06T02:00:00Z') }; return task })
 m.db.auditEntry.findFirst.mockImplementation(async () => audit); m.db.auditEntry.create.mockImplementation(async ({ data }) => { audit = data; return data })
})
const event = (n: number, changes: unknown, userId = 'actor') => ({ id: String(n).padStart(8, '0') + '-1111-4111-8111-111111111111', changes, userId, user: { name: userId === 'actor' ? 'Practice Owner' : 'Colleague', email: 'private@example.invalid' }, createdAt: new Date('2026-11-06T01:00:00Z') })
const completed = (taskId = 'task') => ({ taskCompletion: { inputHash: 'a'.repeat(64), taskHash: 'b'.repeat(64), taskId } })
const rescheduled = { taskReschedule: { inputHash: 'a'.repeat(64), taskHash: 'b'.repeat(64), taskId: 'task', previousDueDate: '2026-11-07T01:00:00.000Z', dueDate: '2099-11-07T01:00:00.000Z' } }
const noWrites = () => { expect(m.db.task.update).not.toHaveBeenCalled(); expect(m.db.activity.create).not.toHaveBeenCalled(); expect(m.db.auditEntry.create).not.toHaveBeenCalled(); expect(m.db.lead.update).not.toHaveBeenCalled() }
it('allows read-only access and projects recorded actors/deadlines without raw audit or email data', async () => {
 m.db.user.findUnique.mockResolvedValue(user(false)); m.db.auditEntry.findMany.mockResolvedValue([event(1, completed()), event(2, rescheduled, 'colleague')])
 const result = await listTaskHistory('org', 'actor', 'item', {})
 expect(result.canWrite).toBe(false); expect(result.data).toMatchObject({ id: 'item', taskId: 'task', page: 1, hasMore: false, entries: [
  { id: event(1, null).id, kind: 'completed', actor: 'You', occurredAt: '2026-11-06T01:00:00.000Z' },
  { id: event(2, null).id, kind: 'rescheduled', actor: 'Colleague', occurredAt: '2026-11-06T01:00:00.000Z', previousDueDate: '2026-11-07T01:00:00.000Z', dueDate: '2099-11-07T01:00:00.000Z' },
 ] })
 expect(JSON.stringify(result)).not.toMatch(/private@example|inputHash|taskHash|assigneeName|Call Practice/); noWrites()
 expect(m.db.auditEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org', entityType: 'FollowUpSuggestion', action: 'UPDATE' }), take: 21, skip: 0 }))
 const query = m.db.auditEntry.findMany.mock.calls[0][0]; expect(query.where.userId).toBeUndefined(); expect(query.select.user).toEqual({ select: { name: true } })
})
it('skips unsupported, mismatched and malformed proofs without disclosing raw fields', async () => {
 m.db.auditEntry.findMany.mockResolvedValue([event(1, completed('foreign')), event(2, { taskCompletion: { taskId: 'task' } }), event(3, { taskReschedule: { ...rescheduled.taskReschedule, dueDate: 'bad' } }), event(4, { status: 'APPROVED', privateText: 'hidden' }), event(5, null), event(6, completed())])
 const result = await listTaskHistory('org', 'actor', 'item', {}); expect(result.data.entries.map(row => row.id)).toEqual([event(6, null).id]); expect(JSON.stringify(result)).not.toContain('hidden'); noWrites()
})
it('bounds scanned pages before parsing and retains older-page access after unsupported records', async () => {
 m.db.auditEntry.findMany.mockResolvedValue(Array.from({ length: 21 }, (_, i) => event(i + 1, i < 20 ? { taskCompletion: { taskId: 'task' } } : completed())))
 const first = await listTaskHistory('org', 'actor', 'item', {}); expect(first.data.entries).toEqual([]); expect(first.data.hasMore).toBe(true)
 m.db.auditEntry.findMany.mockResolvedValue([event(21, completed())]); const second = await listTaskHistory('org', 'actor', 'item', { page: 2 }); expect(second.data.entries).toHaveLength(1); expect(second.data.page).toBe(2); expect(m.db.auditEntry.findMany.mock.calls[1][0]).toMatchObject({ skip: 20, take: 21 }); noWrites()
})
it('supports completed tasks and safe actor fallbacks without requiring write permission', async () => {
 task.isComplete = true; task.completedAt = new Date(); m.db.user.findUnique.mockResolvedValue(user(false)); m.db.auditEntry.findMany.mockResolvedValue([{ ...event(1, completed(), 'colleague'), user: { name: '' } }])
 expect((await listTaskHistory('org', 'actor', 'item', {})).data.entries[0].actor).toBe('Team member'); noWrites()
})
it('rejects missing/foreign/relinked tasks, nonapproved sources and lost lead access before scanning', async () => {
 row.status = 'PENDING'; await expect(listTaskHistory('org', 'actor', 'item', {})).rejects.toMatchObject({ statusCode: 409 }); row.status = 'APPROVED'; row.taskId = 'missing'; await expect(listTaskHistory('org', 'actor', 'item', {})).rejects.toMatchObject({ statusCode: 404 }); row.taskId = 'task'; m.db.lead.findFirst.mockResolvedValue(null); await expect(listTaskHistory('org', 'actor', 'item', {})).rejects.toMatchObject({ statusCode: 404 }); expect(m.db.auditEntry.findMany).not.toHaveBeenCalled(); noWrites()
})
it('rechecks permissions and task scope after scanning before returning private history', async () => {
 m.db.auditEntry.findMany.mockImplementation(async () => { m.db.user.findUnique.mockResolvedValue({ ...user(false), teamMemberships: [] }); return [event(1, completed())] })
 await expect(listTaskHistory('org', 'actor', 'item', {})).rejects.toMatchObject({ statusCode: 403 }); noWrites()
})
it('allows manager task scope but denies final task ownership narrowing', async () => {
 task.assigneeId = 'colleague'; m.db.user.findUnique.mockResolvedValue(user(false, 2)); m.db.auditEntry.findMany.mockImplementation(async () => { m.db.user.findUnique.mockResolvedValue(user(false)); return [event(1, completed(), 'colleague')] })
 await expect(listTaskHistory('org', 'actor', 'item', {})).rejects.toMatchObject({ statusCode: 404 }); noWrites()
})
it('applies the last observed narrowed scope instead of releasing a manager-authorized task history', async () => {
 task.assigneeId = 'colleague'; let lookups = 0
 m.db.user.findUnique.mockImplementation(async () => ++lookups <= 3 ? user(false, 2) : user(false))
 m.db.auditEntry.findMany.mockResolvedValue([event(1, completed(), 'colleague')])
 await expect(listTaskHistory('org', 'actor', 'item', {})).rejects.toMatchObject({ statusCode: 404 })
 noWrites()
})
it.each([{ page: 0 }, { page: 10001 }, { page: 'bad' }, { page: 1, userId: 'other' }])('rejects invalid query %j without reading history', async query => {
 await expect(listTaskHistory('org', 'actor', 'item', query)).rejects.toBeDefined(); expect(m.db.auditEntry.findMany).not.toHaveBeenCalled(); noWrites()
})
