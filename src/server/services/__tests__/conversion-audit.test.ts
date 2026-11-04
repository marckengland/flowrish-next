import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => {
  const state = { lead: {} as Record<string, any>, contact: null as null | Record<string, any>, linked: false, history: [] as unknown[], active: true }
  const db = { lead: { findFirst: vi.fn(), update: vi.fn() }, stage: { findFirst: vi.fn() }, contact: { create: vi.fn() }, leadContact: { findFirst: vi.fn(), create: vi.fn() }, stageTransition: { create: vi.fn() }, cadenceEnrollment: { updateMany: vi.fn() }, $transaction: vi.fn(), $queryRaw: vi.fn() }
  return { state, db, legacyHistory: vi.fn() }
})
vi.mock('@/server/db/middleware', () => ({ createTenantPrisma: () => m.db }))
vi.mock('@/server/db/client', () => ({ prisma: { leadContact: { create: m.db.leadContact.create } } }))
vi.mock('@/server/services/pipeline', () => ({ getOrCreateDefaultPipeline: vi.fn(), createStageTransition: m.legacyHistory }))
vi.mock('@/server/services/assignment', () => ({ evaluateAssignmentRules: vi.fn() }))
import { convertToContact, softDeleteLead } from '../leads'
beforeEach(() => {
  vi.resetAllMocks()
  Object.assign(m.state, { lead: { id: 'lead', organizationId: 'org', assignedUserId: 'self', stageId: 'open', stage: { pipelineId: 'pipeline' }, firstName: 'Practice', lastName: 'Lead', deletedAt: null, isClosed: false, closeDate: null }, contact: null, linked: false, history: [], active: true })
  m.db.lead.findFirst.mockImplementation(async ({ where }) => where.assignedUserId && where.assignedUserId !== m.state.lead.assignedUserId ? null : { ...m.state.lead })
  m.db.lead.update.mockImplementation(async ({ where, data }) => { if (where.stageId && where.stageId !== m.state.lead.stageId) throw { code: 'P2025' }; m.state.lead = { ...m.state.lead, ...data }; return { ...m.state.lead } })
  m.db.stage.findFirst.mockResolvedValue({ id: 'won', isClosedWon: true, isClosedLost: false })
  m.db.contact.create.mockImplementation(async ({ data }) => { m.state.contact = { id: 'contact', ...data }; return m.state.contact })
  m.db.leadContact.create.mockImplementation(async () => { m.state.linked = true; return {} })
  m.db.leadContact.findFirst.mockImplementation(async () => m.state.linked ? { contact: m.state.contact } : null)
  m.db.stageTransition.create.mockImplementation(async data => { m.state.history.push(data); return {} })
  m.legacyHistory.mockImplementation(async () => { m.state.history.push('legacy'); return {} })
  m.db.cadenceEnrollment.updateMany.mockImplementation(async () => { m.state.active = false; return { count: 1 } })
  m.db.$queryRaw.mockResolvedValue([])
  m.db.$transaction.mockImplementation(async fn => { const before = structuredClone(m.state); try { return await fn(m.db) } catch (error) { Object.assign(m.state, before); throw error } })
})
it('rejects conversion and deletion outside the allowed assignee scope before writing', async () => {
  m.state.lead.assignedUserId = 'other'
  await expect(convertToContact('lead', 'self', 'org', { assignedUserId: 'self' })).rejects.toMatchObject({ statusCode: 404 })
  await expect(softDeleteLead('lead', 'self', 'org', { assignedUserId: 'self' })).rejects.toMatchObject({ statusCode: 404 })
  expect(m.db.contact.create).not.toHaveBeenCalled(); expect(m.db.lead.update).not.toHaveBeenCalled()
})
it('rolls back contacts, links, lead state and history when conversion history fails', async () => {
  m.db.stageTransition.create.mockRejectedValue(new Error('Synthetic history failure'))
  m.legacyHistory.mockRejectedValue(new Error('Synthetic history failure'))
  await expect(convertToContact('lead', 'self', 'org')).rejects.toThrow()
  expect(m.state.contact).toBeNull(); expect(m.state.linked).toBe(false); expect(m.state.lead.stageId).toBe('open'); expect(m.state.history).toEqual([]); expect(m.state.active).toBe(true)
})
it('locks and rechecks conversion before writing and reuses its contact on a repeated request', async () => {
  const first = await convertToContact('lead', 'self', 'org', { assignedUserId: 'self' })
  const second = await convertToContact('lead', 'self', 'org', { assignedUserId: 'self' })
  expect(first.contact.id).toBe(second.contact.id); expect(first.lead.closeDate).toEqual(second.lead.closeDate)
  expect(m.db.contact.create).toHaveBeenCalledTimes(1); expect(m.db.stageTransition.create).toHaveBeenCalledTimes(1)
  expect(m.db.$queryRaw).toHaveBeenCalledTimes(2)
  expect(m.db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(m.db.contact.create.mock.invocationCallOrder[0])
  expect(m.db.stage.findFirst.mock.calls[0][0].where).toMatchObject({ pipeline: { organizationId: 'org' }, pipelineId: 'pipeline', isClosedLost: false })
})
it('rejects a competing move detected after the conversion lock without creating a contact', async () => {
  m.db.$queryRaw.mockImplementation(async () => { m.state.lead = { ...m.state.lead, stageId: 'other-stage' }; return [] })
  await expect(convertToContact('lead', 'self', 'org')).rejects.toMatchObject({ statusCode: 409 })
  expect(m.db.contact.create).not.toHaveBeenCalled()
})
