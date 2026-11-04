import { beforeEach, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
const m = vi.hoisted(() => ({ session: vi.fn(), entitlement: vi.fn(), history: vi.fn(), metrics: vi.fn(), submission: vi.fn(), snapshots: vi.fn(), risk: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: m.session }))
vi.mock('@/server/auth/entitlements', () => ({ requireEntitlement: m.entitlement }))
vi.mock('@/server/services/forecast-history', async importOriginal => ({ ...await importOriginal<object>(), getForecastHistory: m.history }))
vi.mock('@/server/services/forecast', () => ({ calculatePipelineMetrics: m.metrics, assessForecastRisk: m.risk }))
vi.mock('@/server/db/middleware', () => ({ createTenantPrisma: () => ({ forecastSubmission: { findFirst: m.submission }, forecastSnapshot: { findMany: m.snapshots } }) }))
import { GET as history } from '@/app/api/forecast/history/route'
import { GET as compare } from '@/app/api/forecast/compare/route'
beforeEach(() => {
  vi.resetAllMocks()
  m.session.mockResolvedValue({ organizationId: 'org', dbUser: { id: 'self', teamMemberships: [{ role: { permissions: [{ key: 'forecast:read' }] } }] } })
  m.metrics.mockResolvedValue({ aiPredicted: 100, totalPipeline: 200, weightedPipeline: 150 })
  m.history.mockResolvedValue({ months: [], snapshots: [] }); m.submission.mockResolvedValue(null); m.snapshots.mockResolvedValue([])
})
it('binds the read-only report to the signed-in organization and user', async () => {
  expect((await history()).status).toBe(200)
  expect(m.history).toHaveBeenCalledWith('org', 'self')
})
it('checks session, permission, and entitlement before querying history', async () => {
  m.session.mockRejectedValueOnce(new AppError('UNAUTHORIZED', 'Sign in', 401))
  expect((await history()).status).toBe(401)
  m.session.mockResolvedValueOnce({ organizationId: 'org', dbUser: { id: 'self', teamMemberships: [] } })
  expect((await history()).status).toBe(403)
  m.entitlement.mockRejectedValueOnce(new AppError('UPGRADE_REQUIRED', 'Unavailable', 403))
  expect((await history()).status).toBe(403)
  expect(m.history).not.toHaveBeenCalled()
})
it('does not compare an unknown legacy commit with owner metrics', async () => {
  m.submission.mockResolvedValue({ id: 'legacy', commitAmount: 200 })
  const response = await compare(), body = await response.json()
  expect(body.data.riskLevel).toBeNull(); expect(body.data.submissionBasisStatus).toBe('unverified')
  expect(m.risk).not.toHaveBeenCalled()
  expect(m.metrics).toHaveBeenCalledWith('org', 'self')
})
it('compares supported owner metadata and labels snapshots independently', async () => {
  const basis = { currency: 'USD', reportingTimezone: 'UTC', calculationVersion: 'usd-stage-v1', scope: 'OWNER' }
  m.submission.mockResolvedValue({ id: 'verified', commitAmount: 200, ...basis })
  m.risk.mockReturnValue('High Risk')
  m.snapshots.mockResolvedValue([{ id: 'legacy', period: '2026-11', snapshotDate: new Date(), totalPipeline: 999, weightedPipeline: 500, aiPredicted: 350 }])
  const response = await compare(), body = await response.json()
  expect(body.data.riskLevel).toBe('High Risk'); expect(body.data.submissionBasisStatus).toBe('verified')
  expect(m.risk).toHaveBeenCalledWith(200, 100)
  expect(body.data.snapshots[0]).toMatchObject({ basisStatus: 'unverified', totalPipeline: null, aiPredicted: null })
})
it('does not expose an unknown or incompatible commit amount under the current USD response label', async () => {
  for (const record of [{ id: 'legacy', commitAmount: 999 }, { id: 'foreign-currency', commitAmount: 999, currency: 'PHP', reportingTimezone: 'UTC', calculationVersion: 'usd-stage-v1', scope: 'OWNER' }]) {
    m.submission.mockResolvedValue(record)
    const body = await (await compare()).json()
    expect(body.data.latestSubmission).toMatchObject({ id: record.id, commitAmount: null })
    expect(body.data.riskLevel).toBeNull()
  }
})
