import { beforeEach, expect, it, vi } from 'vitest'
const a = '11111111-1111-4111-8111-111111111111'
const b = '22222222-2222-4222-8222-222222222222'
const m = vi.hoisted(() => ({ db: { lead: { findFirst: vi.fn(), update: vi.fn() }, stage: { findFirst: vi.fn() }, stageTransition: { create: vi.fn() }, company: { findFirst: vi.fn(), create: vi.fn() }, $transaction: vi.fn() }, oldHistory: vi.fn() }))
vi.mock('@/server/db/middleware', () => ({ createTenantPrisma: () => m.db }))
vi.mock('@/server/services/pipeline', () => ({ getOrCreateDefaultPipeline: vi.fn(), createStageTransition: m.oldHistory }))
vi.mock('@/server/services/assignment', () => ({ evaluateAssignmentRules: vi.fn() }))
import { moveLead, updateLead } from '../leads'
beforeEach(() => {
  vi.resetAllMocks()
  m.db.$transaction.mockImplementation(async fn => fn(m.db))
  m.db.lead.findFirst.mockResolvedValue({ id: 'lead', stageId: a, isClosed: false, closeDate: null })
  m.db.stage.findFirst.mockResolvedValue({ id: b, isClosedWon: true, isClosedLost: false })
  m.db.lead.update.mockImplementation(async args => ({ id: 'lead', ...args.data }))
  m.db.stageTransition.create.mockResolvedValue({ id: 'transition' })
})
it('binds the target stage and final update to the workspace and accessible lead scope', async () => {
  await moveLead('lead', b, 'user', 'org', { assignedUserId: 'user' })
  expect(m.db.stage.findFirst.mock.calls[0][0].where).toMatchObject({ id: b, pipeline: { organizationId: 'org' } })
  expect(m.db.lead.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'lead', organizationId: 'org', assignedUserId: 'user' })
  expect(m.db.lead.update.mock.calls[0][0].where).toMatchObject({ id: 'lead', organizationId: 'org', stageId: a, assignedUserId: 'user' })
  expect(m.db.$transaction).toHaveBeenCalledTimes(1)
})
it('writes closed state and transition together for a generic edit to won', async () => {
  const result = await updateLead('lead', { stageId: b, dealValue: 500 }, 'user', 'org')
  expect(result).toMatchObject({ stageId: b, dealValue: 500, isClosed: true, closeDate: expect.any(Date) })
  expect(m.db.stageTransition.create).toHaveBeenCalledWith({ data: { organizationId: 'org', leadId: 'lead', fromStageId: a, toStageId: b, userId: 'user' } })
})
it('does not leave transition history when the lead update fails', async () => {
  m.db.lead.update.mockRejectedValue(new Error('Synthetic write failure'))
  await expect(moveLead('lead', b, 'user', 'org')).rejects.toThrow()
  expect(m.oldHistory).not.toHaveBeenCalled()
  expect(m.db.stageTransition.create).not.toHaveBeenCalled()
})
it('rejects inaccessible leads and foreign stages before any write', async () => {
  m.db.lead.findFirst.mockResolvedValueOnce(null)
  await expect(moveLead('lead', b, 'user', 'org')).rejects.toMatchObject({ statusCode: 404 })
  m.db.stage.findFirst.mockResolvedValueOnce(null)
  await expect(moveLead('lead', b, 'user', 'org')).rejects.toMatchObject({ statusCode: 404 })
  expect(m.db.lead.update).not.toHaveBeenCalled(); expect(m.db.stageTransition.create).not.toHaveBeenCalled(); expect(m.oldHistory).not.toHaveBeenCalled()
})
it('does not duplicate history or reset closeDate when a move is repeated', async () => {
  const closeDate = new Date('2026-10-01T00:00:00Z')
  m.db.lead.findFirst.mockResolvedValue({ id: 'lead', stageId: b, isClosed: true, closeDate })
  const result = await moveLead('lead', b, 'user', 'org')
  expect(result.closeDate).toEqual(closeDate)
  expect(m.db.lead.update).not.toHaveBeenCalled(); expect(m.db.stageTransition.create).not.toHaveBeenCalled(); expect(m.oldHistory).not.toHaveBeenCalled()
})
it('reopens a closed lead without retaining the old close date', async () => {
  m.db.lead.findFirst.mockResolvedValue({ id: 'lead', stageId: a, isClosed: true, closeDate: new Date() })
  m.db.stage.findFirst.mockResolvedValue({ id: b, isClosedWon: false, isClosedLost: false })
  const result = await moveLead('lead', b, 'user', 'org')
  expect(result).toMatchObject({ stageId: b, isClosed: false, closeDate: null })
})
it('returns a conflict after a competing stage move without leaving history', async () => {
  m.db.lead.update.mockRejectedValue({ code: 'P2025' })
  await expect(moveLead('lead', b, 'user', 'org')).rejects.toMatchObject({ statusCode: 409 })
  expect(m.db.stageTransition.create).not.toHaveBeenCalled(); expect(m.oldHistory).not.toHaveBeenCalled()
})
it('rejects nonfinite and overflowing deal values before beginning a write', async () => {
  for (const dealValue of [Infinity, -Infinity, NaN, 10_000_000_000]) await expect(updateLead('lead', { dealValue }, 'user', 'org')).rejects.toThrow()
  expect(m.db.$transaction).not.toHaveBeenCalled(); expect(m.db.lead.update).not.toHaveBeenCalled()
})
