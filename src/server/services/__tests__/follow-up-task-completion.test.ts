import { beforeEach, expect, it, vi } from 'vitest'
import type { Task } from '@prisma/client'
const m = vi.hoisted(() => ({ db: { $queryRaw: vi.fn(), user: { findUnique: vi.fn() }, lead: { findFirst: vi.fn(), update: vi.fn() }, task: { findFirst: vi.fn(), update: vi.fn() }, followUpSuggestion: { findFirst: vi.fn() }, activity: { create: vi.fn() }, auditEntry: { findFirst: vi.fn(), create: vi.fn() } }, team: { findMany: vi.fn() }, teamMember: { findMany: vi.fn() }, tx: vi.fn(), enabled: vi.fn() }))
vi.mock('@/server/db/client', () => ({ prisma: { $transaction: m.tx, team: m.team, teamMember: m.teamMember } }))
vi.mock('../follow-up-policy', () => ({ followUpWritesEnabled: m.enabled }))
import { completeFollowUpTask, previewTaskCompletion, readTaskCompletion } from '../follow-up-task-completion'
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
async function input() { const p = await previewTaskCompletion('org', 'actor', 'item'); return { requestId, expectedVersion: p.version, taskId: p.task.id } }
const noWrites = () => { expect(m.db.task.update).not.toHaveBeenCalled(); expect(m.db.activity.create).not.toHaveBeenCalled(); expect(m.db.auditEntry.create).not.toHaveBeenCalled(); expect(m.db.lead.update).not.toHaveBeenCalled() }
it('previews current task details and authorized owner without source text or writes', async () => {
 expect(await previewTaskCompletion('org', 'actor', 'item')).toEqual({ id: 'item', version: expect.stringMatching(/^[a-f0-9]{64}$/), leadName: 'Practice Clinic', task: { id: 'task', title: 'Call Practice Clinic', description: 'Confirm their requirements', assigneeId: 'actor', assigneeName: 'Practice Owner', dueDate: '2026-11-07T01:00:00.000Z' } }); noWrites()
 expect(m.db.task.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'task', organizationId: 'org', leadId: 'lead', assigneeId: 'actor' }) }))
})
it('completes the linked task and standard CRM activity atomically, retaining source state and task details', async () => {
 const values = await input(), before = { ...task }, result = await completeFollowUpTask('org', 'actor', 'item', values)
 expect(result).toMatchObject({ id: 'item', requestId, state: 'confirmed', task: { id: 'task', dueDate: '2026-11-07T01:00:00.000Z', completedAt: expect.any(String), checkedAt: expect.any(String) } })
 expect(task).toMatchObject({ ...before, isComplete: true, completedAt: expect.any(Date), updatedAt: expect.any(Date) }); expect(row.status).toBe('APPROVED')
 expect(m.db.activity.create).toHaveBeenCalledWith({ data: { organizationId: 'org', leadId: 'lead', createdById: 'actor', type: 'NOTE', notes: 'Task completed: Call Practice Clinic' } })
 expect(m.db.lead.update).toHaveBeenCalledWith({ where: { id: 'lead', organizationId: 'org' }, data: { lastActivityAt: task.completedAt } })
 expect(m.db.auditEntry.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ id: requestId, organizationId: 'org', userId: 'actor', entityId: 'item', entityType: 'FollowUpSuggestion', changes: expect.objectContaining({ taskCompletion: expect.any(Object) }) }) }))
})
it('replays only the exact request and checks its receipt without duplicate writes', async () => {
 const values = await input(); await completeFollowUpTask('org', 'actor', 'item', values)
 expect((await completeFollowUpTask('org', 'actor', 'item', values)).state).toBe('confirmed'); expect((await readTaskCompletion('org', 'actor', 'item', requestId)).state).toBe('confirmed')
 expect(m.db.task.update).toHaveBeenCalledTimes(1); expect(m.db.activity.create).toHaveBeenCalledTimes(1); expect(m.db.auditEntry.create).toHaveBeenCalledTimes(1)
 await expect(completeFollowUpTask('org', 'actor', 'item', { ...values, expectedVersion: 'b'.repeat(64) })).rejects.toMatchObject({ statusCode: 409 })
 await expect(completeFollowUpTask('org', 'actor', 'item', { ...values, requestId: '22222222-2222-4222-8222-222222222222' })).rejects.toMatchObject({ statusCode: 409 })
})
it.each(['title', 'description', 'dueDate', 'assigneeId', 'updatedAt', 'isComplete'] as const)('rejects a changed task %s after review before writing', async field => {
 const values = await input()
 if (field === 'dueDate' || field === 'updatedAt') task[field] = new Date('2026-11-10T00:00:00Z')
 else if (field === 'isComplete') task.isComplete = true
 else task[field] = 'Changed'
 await expect(completeFollowUpTask('org', 'actor', 'item', values)).rejects.toMatchObject({ statusCode: field === 'assigneeId' ? 404 : 409 }); noWrites()
})
it('rejects changed follow-up links/status and foreign or missing tasks without writing', async () => {
 const values = await input(); row.status = 'PENDING'; await expect(completeFollowUpTask('org', 'actor', 'item', values)).rejects.toMatchObject({ statusCode: 409 }); row.status = 'APPROVED'; row.taskId = 'other'; await expect(completeFollowUpTask('org', 'actor', 'item', values)).rejects.toMatchObject({ statusCode: 404 }); row.taskId = null; await expect(previewTaskCompletion('org', 'actor', 'item')).rejects.toMatchObject({ statusCode: 404 }); noWrites()
})
it('does not claim an externally completed task or changed receipt', async () => {
 expect(await readTaskCompletion('org', 'actor', 'item', requestId)).toEqual({ id: 'item', requestId, state: 'not-recorded', task: null }); const values = await input(); await completeFollowUpTask('org', 'actor', 'item', values); task.title = 'Changed after completion'; expect(await readTaskCompletion('org', 'actor', 'item', requestId)).toEqual({ id: 'item', requestId, state: 'changed', task: null }); expect(m.db.task.update).toHaveBeenCalledTimes(1)
})
it('denies current membership, lead and write access loss on reads and confirmations', async () => {
 const values = await input(); m.db.user.findUnique.mockResolvedValue(user(false)); await expect(completeFollowUpTask('org', 'actor', 'item', values)).rejects.toMatchObject({ statusCode: 403 }); m.db.user.findUnique.mockResolvedValue(user()); m.db.lead.findFirst.mockResolvedValue(null); await expect(readTaskCompletion('org', 'actor', 'item', requestId)).rejects.toMatchObject({ statusCode: 404 }); m.db.$queryRaw.mockResolvedValue([]); await expect(previewTaskCompletion('org', 'actor', 'item')).rejects.toMatchObject({ statusCode: 403 }); noWrites()
})
it('allows a manager to review workspace tasks but rejects final task-scope narrowing', async () => {
 task.assigneeId = 'colleague'; m.db.user.findUnique.mockResolvedValue(user(true, 2)); const values = await input(); expect((await previewTaskCompletion('org', 'actor', 'item')).task.assigneeId).toBe('colleague')
 m.db.user.findUnique.mockResolvedValueOnce(user(true, 2)).mockResolvedValue(user()); await expect(completeFollowUpTask('org', 'actor', 'item', values)).rejects.toMatchObject({ statusCode: 404 }); noWrites()
})
it('honors write pause and rejects malformed/unreviewed input without database writes', async () => {
 const values = await input(); m.enabled.mockReturnValue(false); await expect(completeFollowUpTask('org', 'actor', 'item', values)).rejects.toMatchObject({ statusCode: 503 }); m.enabled.mockReturnValue(true)
 for (const body of [{ ...values, userId: 'other' }, { ...values, taskId: 'wrong' }, { ...values, requestId: 'bad' }, { taskId: 'task' }]) await expect(completeFollowUpTask('org', 'actor', 'item', body)).rejects.toBeDefined()
 noWrites()
})
it('propagates activity failures inside the transaction so no confirmation escapes', async () => {
 const values = await input(); m.db.activity.create.mockRejectedValue(new Error('private failure')); await expect(completeFollowUpTask('org', 'actor', 'item', values)).rejects.toMatchObject({ code: 'FOLLOW_UP_UNAVAILABLE', statusCode: 503 }); expect(m.db.auditEntry.create).not.toHaveBeenCalled()
})
it('locks the lead for update before the task so concurrent completions cannot deadlock on activity time', async () => {
 const values = await input(); m.db.$queryRaw.mockClear(); await completeFollowUpTask('org', 'actor', 'item', values)
 const statements = m.db.$queryRaw.mock.calls.map(call => call[0].join('?'))
 expect(statements.find(sql => sql.includes('"Lead"'))).toContain('FOR UPDATE')
 expect(statements.findIndex(sql => sql.includes('"Lead"'))).toBeLessThan(statements.findIndex(sql => sql.includes('"Task"')))
})
