import { beforeEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
const m = vi.hoisted(() => ({ db: { $queryRaw: vi.fn(), followUpTaskBatch: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() }, followUpSuggestion: { findMany: vi.fn() }, lead: { findMany: vi.fn() }, task: { findMany: vi.fn() }, auditEntry: { findMany: vi.fn() } }, tx: vi.fn(), access: vi.fn(), member: vi.fn(), enabled: vi.fn(), preview: vi.fn(), reschedule: vi.fn() }))
vi.mock('@/server/db/client', () => ({ prisma: { $transaction: m.tx } }))
vi.mock('../follow-up-access', async original => ({ ...await original<typeof import('../follow-up-access')>(), currentFollowUpAccess: m.access, lockFollowUpMember: m.member, requireFollowUpWrites: m.enabled }))
vi.mock('../follow-up-task-completion', () => ({ previewTaskCompletion: m.preview }))
vi.mock('../follow-up-task-reschedule', () => ({ previewTaskReschedule: m.reschedule }))
import { saveTaskBatch, withTaskBatchAttempt, readTaskBatch, listTaskBatches } from '../follow-up-task-batches'
import { approvedTaskHash } from '../follow-up-task-review'
import { AppError } from '@/lib/errors'
const input = { requestId: '11111111-1111-4111-8111-111111111111', expectedVersion: 'a'.repeat(64), taskId: 'task' }
const registration = { id: '22222222-2222-4222-8222-222222222222', kind: 'COMPLETE' as const, items: [{ id: 'source', input }] }
let saved: Record<string, unknown> | null
let task: Record<string, unknown>
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
beforeEach(() => {
 vi.resetAllMocks(); saved = null
 task = { id: 'task', organizationId: 'org', leadId: 'lead', assigneeId: 'actor', title: 'Current title', description: 'not exposed', dueDate: new Date('2030-01-01'), updatedAt: new Date('2026-11-06'), isComplete: false, completedAt: null, priority: 'MEDIUM' }
 m.tx.mockImplementation(run => run(m.db)); m.access.mockResolvedValue({ canWrite: true, filter: {}, taskScope: { assigneeId: 'actor' } }); m.member.mockResolvedValue(undefined)
 m.db.$queryRaw.mockResolvedValue([{ id: 'member' }]); m.preview.mockResolvedValue({ id: 'source', version: input.expectedVersion, task: { id: 'task' } })
 m.db.followUpTaskBatch.findFirst.mockImplementation(async ({ where }) => saved && saved.id === where.id && saved.userId === where.userId && saved.organizationId === where.organizationId ? saved : null)
 m.db.followUpTaskBatch.findMany.mockImplementation(async () => saved ? [saved] : [])
 m.db.followUpTaskBatch.create.mockImplementation(async ({ data }) => saved = { ...data, createdAt: new Date('2026-11-06'), updatedAt: new Date('2026-11-06'), activeIndex: null, nextIndex: 0, stopped: false })
 m.db.followUpTaskBatch.update.mockImplementation(async ({ data }) => saved = { ...saved, ...data })
 m.db.followUpSuggestion.findMany.mockResolvedValue([{ id: 'source', organizationId: 'org', assigneeId: 'actor', status: 'APPROVED', taskId: 'task', leadId: 'lead' }])
 m.db.lead.findMany.mockResolvedValue([{ id: 'lead', firstName: 'Current', lastName: 'Lead' }]); m.db.task.findMany.mockImplementation(async () => [task]); m.db.auditEntry.findMany.mockResolvedValue([])
})
it('saves canonical intent once, rejects changed replays and stale review before saving', async () => {
 const result = await saveTaskBatch('org', 'actor', registration)
 expect(result).toEqual({ registration, createdAt: '2026-11-06T00:00:00.000Z' })
 expect(saved).toMatchObject({ progress: ['NOT_ATTEMPTED'], plan: registration.items, requestHash: expect.stringMatching(/^[a-f0-9]{64}$/) })
 await saveTaskBatch('org', 'actor', registration); expect(m.db.followUpTaskBatch.create).toHaveBeenCalledTimes(1)
 await expect(saveTaskBatch('org', 'actor', { ...registration, items: [{ id: 'source', input: { ...input, expectedVersion: 'b'.repeat(64) } }] })).rejects.toMatchObject({ statusCode: 409 })
 saved = null; m.preview.mockResolvedValue({ id: 'source', version: 'b'.repeat(64), task: { id: 'task' } }); await expect(saveTaskBatch('org', 'actor', registration)).rejects.toMatchObject({ statusCode: 409 }); expect(m.db.followUpTaskBatch.create).toHaveBeenCalledTimes(1)
})
it('writes an uncertain marker before the task effect and never repeats an attempted request', async () => {
 await saveTaskBatch('org', 'actor', registration)
 const run = vi.fn(async () => { expect(saved).toMatchObject({ progress: ['UNCERTAIN'], activeIndex: 0 }); return { id: 'source', requestId: input.requestId, state: 'confirmed', task: { id: 'task' } } })
 await withTaskBatchAttempt('org', 'actor', registration.id, 'COMPLETE', 'source', input, run)
 expect(saved).toMatchObject({ progress: ['CONFIRMED'], activeIndex: null, nextIndex: 1 })
 await expect(withTaskBatchAttempt('org', 'actor', registration.id, 'COMPLETE', 'source', input, run)).rejects.toMatchObject({ statusCode: 409 }); expect(run).toHaveBeenCalledTimes(1)
})
it.each([new AppError('CHANGED', 'safe', 409), new Error('private')])('stops after a failed or uncertain attempt without claiming later requests', async cause => {
 await saveTaskBatch('org', 'actor', registration)
 await expect(withTaskBatchAttempt('org', 'actor', registration.id, 'COMPLETE', 'source', input, async () => { throw cause })).rejects.toBeDefined()
 expect(saved).toMatchObject({ stopped: true, progress: [cause instanceof AppError ? 'FAILED' : 'UNCERTAIN'] })
})
it('denies foreign owner, wrong kind, changed input, and out-of-order requests before calling service', async () => {
 await saveTaskBatch('org', 'actor', registration); const run = vi.fn()
 for (const [org, user, kind, raw] of [['foreign', 'actor', 'COMPLETE', input], ['org', 'foreign', 'COMPLETE', input], ['org', 'actor', 'RESCHEDULE', input], ['org', 'actor', 'COMPLETE', { ...input, taskId: 'other' }]] as const) await expect(withTaskBatchAttempt(org, user, registration.id, kind, 'source', raw, run)).rejects.toBeDefined()
 saved!.activeIndex = 0; await expect(withTaskBatchAttempt('org', 'actor', registration.id, 'COMPLETE', 'source', input, run)).rejects.toMatchObject({ statusCode: 409 }); expect(run).not.toHaveBeenCalled()
})
it('uses only exact audit proofs and preserves historical success after later task changes', async () => {
 await saveTaskBatch('org', 'actor', registration)
 task.isComplete = true
 expect((await readTaskBatch('org', 'actor', registration.id)).items[0]).toMatchObject({ state: 'not-attempted' })
 const changes = { taskCompletion: { inputHash: hash(input), taskHash: approvedTaskHash(task as never), taskId: 'task' } }
 m.db.auditEntry.findMany.mockResolvedValue([{ id: input.requestId, entityId: 'source', changes }])
 expect((await readTaskBatch('org', 'actor', registration.id)).items[0]).toMatchObject({ state: 'confirmed', currentChanged: false })
 task.title = 'Later edit'
 expect((await readTaskBatch('org', 'actor', registration.id)).items[0]).toMatchObject({ state: 'confirmed', currentChanged: true, task: { title: 'Later edit' } })
 changes.taskCompletion.inputHash = 'b'.repeat(64)
 expect((await readTaskBatch('org', 'actor', registration.id)).items[0].state).toBe('not-attempted')
 expect(m.db.followUpTaskBatch.update).not.toHaveBeenCalled()
})
it('redacts revoked tasks and allows read-only history without source text or request metadata', async () => {
 await saveTaskBatch('org', 'actor', registration); m.access.mockResolvedValue({ canWrite: false, filter: {}, taskScope: { assigneeId: 'actor' } }); m.db.task.findMany.mockResolvedValue([])
 expect((await readTaskBatch('org', 'actor', registration.id)).items).toEqual([{ index: 0, state: 'unavailable' }])
 const list = await listTaskBatches('org', 'actor'); expect(list.items[0].counts.unavailable).toBe(1); expect(JSON.stringify(list)).not.toContain('taskId')
 await expect(readTaskBatch('org', 'other', registration.id)).rejects.toMatchObject({ statusCode: 404 })
 expect(m.db.followUpTaskBatch.update).not.toHaveBeenCalled(); expect(m.access).toHaveBeenLastCalledWith(m.db, 'org', 'other', false)
})
it('keeps started requests uncertain when no audit exists and checks never mutate', async () => {
 await saveTaskBatch('org', 'actor', registration); saved!.progress = ['UNCERTAIN']; saved!.activeIndex = 0
 expect((await readTaskBatch('org', 'actor', registration.id)).items[0].state).toBe('uncertain')
 expect(m.db.followUpTaskBatch.update).not.toHaveBeenCalled()
})
