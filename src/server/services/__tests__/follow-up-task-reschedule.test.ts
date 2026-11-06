import { beforeEach, expect, it, vi } from 'vitest'
import type { Task } from '@prisma/client'
const m = vi.hoisted(() => ({ db: { $queryRaw: vi.fn(), user: { findUnique: vi.fn() }, lead: { findFirst: vi.fn(), update: vi.fn() }, task: { findFirst: vi.fn(), update: vi.fn() }, followUpSuggestion: { findFirst: vi.fn() }, activity: { create: vi.fn() }, auditEntry: { findFirst: vi.fn(), create: vi.fn() } }, team: { findMany: vi.fn() }, teamMember: { findMany: vi.fn() }, tx: vi.fn(), enabled: vi.fn() }))
vi.mock('@/server/db/client', () => ({ prisma: { $transaction: m.tx, team: m.team, teamMember: m.teamMember } }))
vi.mock('../follow-up-policy', () => ({ followUpWritesEnabled: m.enabled }))
import { rescheduleFollowUpTask, previewTaskReschedule, readTaskReschedule } from '../follow-up-task-reschedule'
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
const target = { localTime: '2099-11-07T09:00', timeZone: 'Asia/Manila' }
async function input() { const p = await previewTaskReschedule('org', 'actor', 'item', target); return { requestId, expectedVersion: p.version, taskId: p.task.id, ...target } }
const noWrites = () => { expect(m.db.task.update).not.toHaveBeenCalled(); expect(m.db.activity.create).not.toHaveBeenCalled(); expect(m.db.auditEntry.create).not.toHaveBeenCalled(); expect(m.db.lead.update).not.toHaveBeenCalled() }
it('previews both deadlines from the server-resolved timezone without writing', async () => {
 const p = await previewTaskReschedule('org', 'actor', 'item', target)
 expect(p).toMatchObject({ id: 'item', version: expect.stringMatching(/^[a-f0-9]{64}$/), leadName: 'Practice Clinic', ...target, newDueDate: '2099-11-07T01:00:00.000Z', task: { id: 'task', title: 'Call Practice Clinic', dueDate: '2026-11-07T01:00:00.000Z', assigneeName: 'Practice Owner' } }); noWrites()
})
it('changes only the deadline and writes one CRM activity and exact receipt', async () => {
 const before = { ...task }, values = await input(), result = await rescheduleFollowUpTask('org', 'actor', 'item', values)
 expect(task).toEqual({ ...before, dueDate: new Date('2099-11-07T01:00:00.000Z'), updatedAt: new Date('2026-11-06T02:00:00Z') })
 expect(result).toMatchObject({ id: 'item', requestId, state: 'confirmed', task: { id: 'task', previousDueDate: '2026-11-07T01:00:00.000Z', dueDate: '2099-11-07T01:00:00.000Z' } })
 expect(m.db.activity.create).toHaveBeenCalledWith({ data: expect.objectContaining({ organizationId: 'org', leadId: 'lead', createdById: 'actor', type: 'NOTE', notes: expect.stringContaining('2026-11-07T01:00:00.000Z → 2099-11-07T01:00:00.000Z') }) }); expect(row.status).toBe('APPROVED'); expect(task.isComplete).toBe(false)
 await rescheduleFollowUpTask('org', 'actor', 'item', values); expect((await readTaskReschedule('org', 'actor', 'item', requestId)).state).toBe('confirmed')
 expect(m.db.activity.create).toHaveBeenCalledTimes(1); expect(m.db.task.update).toHaveBeenCalledTimes(1); expect(m.db.auditEntry.create).toHaveBeenCalledTimes(1)
})
it.each([{ localTime: '2020-11-07T09:00', timeZone: 'Asia/Manila' }, { localTime: '2099-02-30T09:00', timeZone: 'Asia/Manila' }, { localTime: '2099-11-07T09:00', timeZone: 'Invalid/Zone' }, { localTime: '2027-03-14T02:30', timeZone: 'America/New_York' }, { localTime: '2027-11-07T01:30', timeZone: 'America/New_York' }])('rejects invalid, past or ambiguous local time %j', async values => {
 await expect(previewTaskReschedule('org', 'actor', 'item', values)).rejects.toMatchObject({ statusCode: 400 }); noWrites()
})
it('rejects unchanged deadlines, completed tasks, and a target changed after review', async () => {
 await expect(previewTaskReschedule('org', 'actor', 'item', { localTime: '2026-11-07T09:00', timeZone: 'Asia/Manila' })).rejects.toMatchObject({ statusCode: 400 })
 const values = await input(); await expect(rescheduleFollowUpTask('org', 'actor', 'item', { ...values, localTime: '2099-11-08T09:00' })).rejects.toMatchObject({ statusCode: 409 }); task.isComplete = true; await expect(rescheduleFollowUpTask('org', 'actor', 'item', values)).rejects.toMatchObject({ statusCode: 409 }); noWrites()
})
it.each(['title', 'dueDate', 'assigneeId', 'updatedAt'] as const)('rejects stale task %s without writing', async field => {
 const values = await input()
 if (field === 'dueDate' || field === 'updatedAt') task[field] = new Date('2099-01-01')
 else task[field] = 'Changed'
 await expect(rescheduleFollowUpTask('org', 'actor', 'item', values)).rejects.toMatchObject({ statusCode: field === 'assigneeId' ? 404 : 409 }); noWrites()
})
it('rejects wrong task/source/identity, write pause, and lost permissions before writing', async () => {
 const values = await input()
 await expect(rescheduleFollowUpTask('org', 'actor', 'item', { ...values, taskId: 'other' })).rejects.toMatchObject({ statusCode: 409 })
 await expect(rescheduleFollowUpTask('org', 'actor', 'item', { ...values, userId: 'other' })).rejects.toBeDefined()
 m.enabled.mockReturnValue(false); await expect(rescheduleFollowUpTask('org', 'actor', 'item', values)).rejects.toMatchObject({ statusCode: 503 }); m.enabled.mockReturnValue(true)
 m.db.user.findUnique.mockResolvedValue(user(false)); await expect(rescheduleFollowUpTask('org', 'actor', 'item', values)).rejects.toMatchObject({ statusCode: 403 }); m.db.user.findUnique.mockResolvedValue(user()); row.status = 'PENDING'; await expect(rescheduleFollowUpTask('org', 'actor', 'item', values)).rejects.toMatchObject({ statusCode: 409 }); noWrites()
})
it('checks exact receipts without writes and refuses conflicting request reuse', async () => {
 expect(await readTaskReschedule('org', 'actor', 'item', requestId)).toEqual({ id: 'item', requestId, state: 'not-recorded', task: null })
 const values = await input(); await rescheduleFollowUpTask('org', 'actor', 'item', values); await expect(rescheduleFollowUpTask('org', 'actor', 'item', { ...values, localTime: '2099-11-08T09:00' })).rejects.toMatchObject({ statusCode: 409 })
 task.dueDate = new Date('2099-11-09'); expect(await readTaskReschedule('org', 'actor', 'item', requestId)).toEqual({ id: 'item', requestId, state: 'changed', task: null }); expect(m.db.task.update).toHaveBeenCalledTimes(1)
})
it('uses manager scope and rejects a final narrowing while preserving read privacy', async () => {
 task.assigneeId = 'colleague'; m.db.user.findUnique.mockResolvedValue(user(true, 2)); const values = await input(); m.db.user.findUnique.mockResolvedValueOnce(user(true, 2)).mockResolvedValue(user()); await expect(rescheduleFollowUpTask('org', 'actor', 'item', values)).rejects.toMatchObject({ statusCode: 404 }); noWrites()
})
