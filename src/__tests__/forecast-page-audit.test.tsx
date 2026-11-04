import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
const m = vi.hoisted(() => ({ session: vi.fn(), entitlement: vi.fn(), metrics: vi.fn(), win: vi.fn(), submission: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: m.session }))
vi.mock('@/server/auth/entitlements', () => ({ requireEntitlement: m.entitlement }))
vi.mock('@/server/services/forecast', () => ({ calculatePipelineMetrics: m.metrics, calculateWinRate: m.win, assessForecastRisk: vi.fn() }))
vi.mock('@/server/db/middleware', () => ({ createTenantPrisma: () => ({ forecastSubmission: { findFirst: m.submission } }) }))
vi.mock('@/components/forecast/commit-form', () => ({ CommitForm: () => null }))
import Page from '@/app/(dashboard)/forecast/page'
beforeEach(() => {
  vi.resetAllMocks()
  m.session.mockResolvedValue({ organizationId: 'org', dbUser: { id: 'user', teamMemberships: [{ role: { permissions: [{ key: 'forecast:read' }] } }] } })
  m.metrics.mockResolvedValue({ totalPipeline: 0, weightedPipeline: 0, aiPredicted: 0 }); m.win.mockResolvedValue(0); m.submission.mockResolvedValue(null)
})
afterEach(cleanup)
it('denies an unavailable forecasting entitlement before querying financial data', async () => {
  m.entitlement.mockRejectedValue(new AppError('UPGRADE_REQUIRED', 'Synthetic unavailable forecasting', 403))
  render(await Page())
  expect(screen.getByText(/Forecasting isn.t enabled/)).toBeVisible()
  expect(m.metrics).not.toHaveBeenCalled(); expect(m.win).not.toHaveBeenCalled(); expect(m.submission).not.toHaveBeenCalled()
})
it('denies missing read permission before checking plan or querying data', async () => {
  m.session.mockResolvedValue({ organizationId: 'org', dbUser: { teamMemberships: [] } })
  render(await Page())
  expect(screen.getByText(/don.t have permission/)).toBeVisible()
  expect(m.entitlement).not.toHaveBeenCalled(); expect(m.metrics).not.toHaveBeenCalled(); expect(m.submission).not.toHaveBeenCalled()
})
