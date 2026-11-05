import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => {
  const db = { user: { findUnique: vi.fn() }, organizationMember: { findUnique: vi.fn() }, lead: { findFirst: vi.fn(), findMany: vi.fn() }, task: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() }, receptionistCall: { findMany: vi.fn() }, followUpSuggestion: { findFirst: vi.fn(), findMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() }, auditEntry: { create: vi.fn() }, $queryRaw: vi.fn() }
  return { db, transaction: vi.fn(), filter: vi.fn() }
})
vi.mock('@/server/db/client', () => ({ prisma: { ...m.db, $transaction: m.transaction } }))
vi.mock('../access', () => ({ getLeadAccessFilter: m.filter }))
import { listFollowUps, reviewFollowUp } from '../follow-ups'
const user = (write = true) => ({ id: 'actor', organizationMemberships: [{ organizationId: 'org' }], teamMemberships: [{ role: { hierarchy: 3, permissions: [{ key: 'leads:read' }, ...(write ? [{ key: 'leads:write' }] : [])] } }] })
const row = { id: 'followup', organizationId: 'org', assigneeId: 'actor', leadId: 'lead', sourceType: 'EMAIL', sourceId: 'message', sourceKey: '["gmail","account","message"]', status: 'PENDING', title: 'Private follow-up', description: 'Private notes', taskId: null, updatedAt: new Date('2026-11-05') }
const lead = { id: 'lead', firstName: 'Private', lastName: 'Practice', email: 'private@example.invalid' }
beforeEach(() => {
  vi.resetAllMocks(); m.transaction.mockImplementation(async fn => fn(m.db)); m.filter.mockResolvedValue({ deletedAt: null, assignedUserId: 'actor' }); m.db.user.findUnique.mockResolvedValue(user()); m.db.organizationMember.findUnique.mockResolvedValue({ id: 'member' }); m.db.$queryRaw.mockResolvedValue([{ id: 'locked' }]); m.db.lead.findFirst.mockResolvedValue(lead); m.db.lead.findMany.mockResolvedValue([lead]); m.db.task.findMany.mockResolvedValue([]); m.db.receptionistCall.findMany.mockResolvedValue([]); m.db.followUpSuggestion.findMany.mockResolvedValue([row]); m.db.followUpSuggestion.findFirst.mockResolvedValue(row); m.db.followUpSuggestion.updateMany.mockResolvedValue({ count: 1 }); m.db.followUpSuggestion.update.mockResolvedValue({ ...row, status: 'APPROVED', taskId: 'task' }); m.db.task.create.mockResolvedValue({ id: 'task' })
})
it('does not list an assignee’s follow-up after lead access is lost', async () => {
  m.db.lead.findMany.mockImplementation(async ({ where }) => where.assignedUserId || where.AND ? [] : [lead]); const result = await listFollowUps('org', 'actor'); const items = Array.isArray(result) ? result : result.items; expect(items).toEqual([]); expect(JSON.stringify(result)).not.toContain('Private notes')
})
it('authorizes reviewed history before returning an idempotent result', async () => {
  m.db.followUpSuggestion.findFirst.mockResolvedValue({ ...row, status: 'APPROVED', taskId: 'existing' }); m.db.lead.findFirst.mockResolvedValue(null); await expect(reviewFollowUp('org', 'actor', 'followup', { action: 'approve' })).rejects.toMatchObject({ statusCode: 404 }); expect(m.db.task.create).not.toHaveBeenCalled()
})
it('refuses callback dismissal after its task moves to another owner', async () => {
  m.db.followUpSuggestion.findFirst.mockResolvedValue({ ...row, sourceType: 'CALL', taskId: 'callback-task' }); m.db.task.findFirst.mockResolvedValue(null); await expect(reviewFollowUp('org', 'actor', 'followup', { action: 'dismiss' })).rejects.toMatchObject({ statusCode: 404 }); expect(m.db.followUpSuggestion.updateMany).not.toHaveBeenCalled(); expect(m.db.auditEntry.create).not.toHaveBeenCalled()
})
it('checks current write permission inside review instead of trusting a previous request check', async () => {
  m.db.user.findUnique.mockResolvedValue(user(false)); await expect(reviewFollowUp('org', 'actor', 'followup', { action: 'approve' })).rejects.toMatchObject({ statusCode: 403 }); expect(m.db.task.create).not.toHaveBeenCalled()
})
it('rechecks permission after workflow/audit waits before committing', async () => {
  m.db.auditEntry.create.mockImplementation(async () => { m.db.user.findUnique.mockResolvedValue(user(false)); return { id: 'audit' } }); await expect(reviewFollowUp('org', 'actor', 'followup', { action: 'approve' })).rejects.toMatchObject({ statusCode: 403 })
})
it('reports fresh read-only capability without creating a task', async () => {
  m.db.user.findUnique.mockResolvedValue(user(false)); const result = await listFollowUps('org', 'actor'); expect(result).toMatchObject({ canWrite: false }); expect(m.db.task.create).not.toHaveBeenCalled()
})
it('locks every callback lead in canonical order before the first task lock', async () => {
  const low = { id: 'low', leadId: 'a-lead', taskId: 'a-task', title: 'Earlier', description: '' }, high = { id: 'high', leadId: 'z-lead', taskId: 'z-task', title: 'Newer', description: '' }
  Object.assign(m.db.receptionistCall, { findFirst: vi.fn(async () => null) }); m.db.task.findMany.mockResolvedValue([{ id: low.taskId, leadId: low.leadId }, { id: high.taskId, leadId: high.leadId }]); m.db.receptionistCall.findMany.mockResolvedValue([high, low]); m.db.task.findFirst.mockImplementation(async ({ where }) => ({ id: where.id, leadId: where.leadId })); m.db.followUpSuggestion.findMany.mockResolvedValue([]); await listFollowUps('org', 'actor'); const locks = m.db.$queryRaw.mock.calls.map(args => ({ sql: args[0].join(''), values: args.slice(1) })); const firstLead = locks.findIndex(row => row.sql.includes('FROM "Lead"')), firstTask = locks.findIndex(row => row.sql.includes('FROM "Task"')); expect(locks[firstLead].sql).toContain('ORDER BY'); expect(JSON.stringify(locks[firstLead].values)).toContain('a-lead'); expect(JSON.stringify(locks[firstLead].values)).toContain('z-lead'); expect(firstLead).toBeLessThan(firstTask)
})
