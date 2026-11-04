import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ find: vi.fn(), count: vi.fn(), create: vi.fn() }))
vi.mock('@/server/db/middleware', () => ({ createTenantPrisma: () => ({ lead: { findMany: m.find, count: m.count }, forecastSubmission: { create: m.create } }) }))
import { calculatePipelineMetrics, submitForecast } from '../forecast'
beforeEach(() => { vi.resetAllMocks(); m.find.mockResolvedValue([]); m.create.mockResolvedValue({ id: 'submission' }) })
it('uses the displayed USD basis for both open pipeline and closed-won run rate', async () => {
  await calculatePipelineMetrics('org')
  expect(m.find.mock.calls).toHaveLength(2)
  for (const [args] of m.find.mock.calls) expect(args.where.currency).toBe('USD')
  expect(m.find.mock.calls[0][0].where.stage).toMatchObject({ isClosedWon: false, isClosedLost: false })
})
it('keeps weighting between zero and the deal value even with sparse or invalid stage orders', async () => {
  m.find.mockResolvedValueOnce([{ dealValue: 100, stage: { order: 100, pipeline: { stages: [{}, {}] } } }, { dealValue: 100, stage: { order: -1, pipeline: { stages: [{}] } } }]).mockResolvedValueOnce([])
  const metrics = await calculatePipelineMetrics('org')
  expect(metrics.totalPipeline).toBe(200); expect(metrics.weightedPipeline).toBe(100); expect(metrics.aiPredicted).toBe(70)
})
it('rejects nonfinite, negative and database-overflow commits without writing', async () => {
  for (const value of [Infinity, -Infinity, NaN, -1, 10_000_000_000]) await expect(submitForecast('user', 'org', '2026-11', value)).rejects.toMatchObject({ statusCode: 400 })
  expect(m.create).not.toHaveBeenCalled()
})
