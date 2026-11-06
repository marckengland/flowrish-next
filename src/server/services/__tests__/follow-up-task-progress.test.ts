import { beforeEach, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
const m = vi.hoisted(() => ({ db: { user: { findUnique: vi.fn() }, lead: { findMany: vi.fn() }, task: { findMany: vi.fn() }, receptionistCall: { findMany: vi.fn() }, followUpSuggestion: { findMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn() }, followUpSnooze: { findMany: vi.fn() }, $queryRaw: vi.fn() }, tx: vi.fn() }))
vi.mock('@/server/db/client', () => ({ prisma: { $transaction: m.tx } }))
vi.mock('../access', () => ({ getLeadAccessFilter: vi.fn(async () => ({ deletedAt: null, assignedUserId: 'actor' })) }))
import { listFollowUps } from '../follow-ups'
const now = new Date('2026-11-06T01:00:00Z'), id = '11111111-1111-4111-8111-111111111111'
const row = { id, organizationId: 'org', assigneeId: 'actor', leadId: 'lead', taskId: 'task', status: 'APPROVED', sourceType: 'EMAIL', title: 'Reviewed', createdAt: now, updatedAt: now }
const task = { id: 'task', leadId: 'lead', dueDate: new Date('2026-11-06T00:00:00Z'), isComplete: false, completedAt: null }
const actor = (hierarchy = 3) => ({ id: 'actor', organizationMemberships: [{ organizationId: 'org' }], teamMemberships: [{ role: { hierarchy, permissions: [{ key: 'leads:read' }] } }] })
let query: Prisma.Sql | undefined
beforeEach(() => {
 vi.resetAllMocks(); query = undefined; m.tx.mockImplementation(run => run(m.db)); m.db.user.findUnique.mockResolvedValue(actor()); m.db.lead.findMany.mockResolvedValue([{ id: 'lead', firstName: 'Practice', lastName: 'Clinic', email: 'lead@example.invalid' }]); m.db.task.findMany.mockImplementation(async args => args.select.dueDate ? [task] : []); m.db.followUpSuggestion.findMany.mockResolvedValue([row]); m.db.followUpSnooze.findMany.mockResolvedValue([])
 m.db.$queryRaw.mockImplementation(async (q, ...values) => { const sql = Prisma.sql(q as TemplateStringsArray, ...values); if (sql.text.includes('AS now')) return [{ now }]; if (sql.text.includes('WITH eligible')) { query = sql; return [{ id, createdAt: now, isPage: true, hasMore: false }] }; return [{ id: 'member' }] })
})
it('reads overdue metadata with member task scope and no catch-up or workflow writes', async () => {
 const result = await listFollowUps('org', 'actor', 'APPROVED', [], { taskProgress: 'OVERDUE' }, {}, true)
 expect(result.items[0]).toMatchObject({ taskProgress: { state: 'OVERDUE', dueDate: '2026-11-06T00:00:00.000Z', completedAt: null, checkedAt: now.toISOString() } }); expect(result.canWrite).toBe(false)
 expect(query?.text).toContain('progressTaskId'); expect(query!.text.indexOf('progressDueDate')).toBeLessThan(query!.text.indexOf('LIMIT 100')); expect(m.db.task.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org', assigneeId: 'actor', id: { in: ['task'] } }), select: expect.objectContaining({ dueDate: true, isComplete: true }) }))
 expect(m.db.receptionistCall.findMany).not.toHaveBeenCalled(); expect(m.db.followUpSuggestion.createMany).not.toHaveBeenCalled(); expect(m.db.followUpSuggestion.updateMany).not.toHaveBeenCalled()
})
it('uses persisted completion and redacts missing or wrong-lead task metadata', async () => {
 m.db.task.findMany.mockImplementation(async args => args.select.dueDate ? [{ ...task, isComplete: true }] : []); expect((await listFollowUps('org', 'actor', 'APPROVED', [], { taskProgress: 'COMPLETED' }, {}, true)).items[0].taskProgress).toMatchObject({ state: 'COMPLETED', completedAt: null })
 for (const tasks of [[], [{ ...task, leadId: 'foreign-lead' }]]) { m.db.task.findMany.mockImplementation(async args => args.select.dueDate ? tasks : []); const result = await listFollowUps('org', 'actor', 'APPROVED', [], {}, {}, true); expect(result.items[0].taskProgress).toEqual({ state: 'UNAVAILABLE' }); expect(JSON.stringify(result.items[0].taskProgress)).not.toContain('dueDate') }
})
it('rejects task-state races rather than returning a mismatched filtered page', async () => {
 m.db.task.findMany.mockImplementation(async args => args.select.dueDate ? [{ ...task, isComplete: true }] : []); await expect(listFollowUps('org', 'actor', 'APPROVED', [], { taskProgress: 'OPEN' }, {}, true)).rejects.toMatchObject({ statusCode: 409 })
})
it('keeps retained drafts outside the task filter and leaves legacy responses unchanged', async () => {
 m.db.$queryRaw.mockImplementation(async (q, ...values) => { const sql = Prisma.sql(q as TemplateStringsArray, ...values); if (sql.text.includes('AS now')) return [{ now }]; if (sql.text.includes('WITH eligible')) return [{ id, createdAt: now, isPage: false, hasMore: false }]; return [{ id: 'member' }] })
 expect((await listFollowUps('org', 'actor', 'APPROVED', [id], { taskProgress: 'COMPLETED' }, {}, true)).items[0].taskProgress).toMatchObject({ state: 'OVERDUE' })
 expect((await listFollowUps('org', 'actor', 'APPROVED')).items[0]).not.toHaveProperty('taskProgress')
})
it('matches manager task scope and rejects invalid tab/opt-in combinations before database access', async () => {
 for (const args of [['PENDING', true], ['APPROVED', false]] as const) await expect(listFollowUps('org', 'actor', args[0], [], { taskProgress: 'OPEN' }, {}, args[1])).rejects.toMatchObject({ statusCode: 400 }); expect(m.tx).not.toHaveBeenCalled()
 m.db.user.findUnique.mockResolvedValue(actor(2)); await listFollowUps('org', 'actor', 'APPROVED', [], {}, {}, true); const call = m.db.task.findMany.mock.calls.find(([args]) => args.select.dueDate)![0]; expect(call.where).not.toHaveProperty('assigneeId'); expect(call.where.lead).toMatchObject({ organizationId: 'org', AND: [{ deletedAt: null, assignedUserId: 'actor' }] })
})
it('keeps an unfinished task due exactly at the server check time Open', async () => {
 m.db.task.findMany.mockImplementation(async args => args.select.dueDate ? [{ ...task, dueDate: now }] : [])
 const result = await listFollowUps('org', 'actor', 'APPROVED', [], { taskProgress: 'OPEN' }, {}, true); expect(result.items[0].taskProgress).toEqual({ state: 'OPEN', dueDate: now.toISOString(), completedAt: null, checkedAt: now.toISOString() })
})
it('rejects a narrowed task scope at the final permission check even if lead scope is unchanged', async () => {
 let reads = 0; m.db.user.findUnique.mockImplementation(async () => actor(++reads < 3 ? 2 : 3))
 await expect(listFollowUps('org', 'actor', 'APPROVED', [], {}, {}, true)).rejects.toMatchObject({ statusCode: 404 })
})
