import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ find: vi.fn(), count: vi.fn() }))
vi.mock('@/server/db/middleware', () => ({ createTenantPrisma: () => ({ lead: { findMany: m.find, count: m.count } }) }))
vi.mock('@/server/services/pipeline', () => ({ getOrCreateDefaultPipeline: vi.fn(), createStageTransition: vi.fn() }))
vi.mock('@/server/services/assignment', () => ({ evaluateAssignmentRules: vi.fn() }))
import { getLeads } from '../leads'
beforeEach(() => { vi.resetAllMocks(); m.find.mockResolvedValue([]); m.count.mockResolvedValue(0) })
it('keeps the mandatory owner constraint when an assignee filter is forged', async () => {
  await getLeads({ assignedUserId: 'colleague' }, {}, { deletedAt: null, assignedUserId: 'self' }, 'org')
  const where = m.find.mock.calls[0][0].where
  expect(where.assignedUserId).toBe('self')
  expect(where.AND).toContainEqual({ assignedUserId: 'colleague' })
  expect(m.count.mock.calls[0][0].where).toEqual(where)
})
it('binds both board rows and their total to the selected pipeline', async () => {
  await getLeads({ pipelineId: 'pipeline' }, { page: 1, pageSize: 200 }, { deletedAt: null }, 'org')
  expect(m.find.mock.calls[0][0].where.stage).toEqual({ pipelineId: 'pipeline' })
  expect(m.count.mock.calls[0][0].where.stage).toEqual({ pipelineId: 'pipeline' })
})
