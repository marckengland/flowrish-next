import { expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ organizations: vi.fn(), create: vi.fn(), count: vi.fn(), metrics: vi.fn() }))
vi.mock('../client', () => ({ inngest: { createFunction: (_config: unknown, handler: unknown) => handler } }))
vi.mock('@/server/db/client', () => ({ prisma: { organization: { findMany: m.organizations } } }))
vi.mock('@/server/db/middleware', () => ({ createTenantPrisma: () => ({ lead: { count: m.count }, forecastSnapshot: { create: m.create } }) }))
vi.mock('@/server/services/forecast', () => ({ calculatePipelineMetrics: m.metrics }))
import { forecastSnapshotFunction } from '../forecast-snapshot'
it('records a business snapshot basis without relabeling historical snapshots or creating personal records', async () => {
  m.organizations.mockResolvedValue([{ id: 'org' }]); m.count.mockResolvedValue(0); m.metrics.mockResolvedValue({ totalPipeline: 100, weightedPipeline: 50, aiPredicted: 35 })
  const run = forecastSnapshotFunction as unknown as (event: { step: { run: (name: string, fn: () => unknown) => unknown } }) => Promise<unknown>
  await run({ step: { run: (_name, fn) => fn() } })
  expect(m.create).toHaveBeenCalledTimes(1)
  expect(m.create.mock.calls[0][0].data).toMatchObject({ currency: 'USD', reportingTimezone: 'UTC', calculationVersion: 'usd-stage-v1', scope: 'ORGANIZATION', totalPipeline: 100 })
  expect(Object.keys(m.create.mock.calls[0][0].data)).not.toContain('userId')
})
