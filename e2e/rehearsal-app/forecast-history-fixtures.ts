import type { ForecastHistoryReport } from '@/lib/forecast-basis'
export const forecastHistoryReport: ForecastHistoryReport = {
  currency: 'USD', reportingTimezone: 'UTC', calculationVersion: 'usd-stage-v1', asOf: '2026-11-04T09:00:00Z',
  months: [
    { period: '2026-11', inProgress: true, basisStatus: 'verified', commitAmount: 100, submittedAt: '2026-11-01T00:00:00Z', wonRevenue: 125.50, delta: 25.50, attainment: 125.5 },
    { period: '2026-10', inProgress: false, basisStatus: 'unverified', commitAmount: null, submittedAt: '2026-10-01T00:00:00Z', wonRevenue: 50, delta: null, attainment: null },
    { period: '2026-09', inProgress: false, basisStatus: 'incompatible', commitAmount: null, submittedAt: '2026-09-01T00:00:00Z', wonRevenue: 50, delta: null, attainment: null },
    { period: '2026-08', inProgress: false, basisStatus: 'verified', commitAmount: 0, submittedAt: '2026-08-01T00:00:00Z', wonRevenue: 0, delta: 0, attainment: null },
    { period: '2026-07', inProgress: false, basisStatus: 'missing', commitAmount: null, submittedAt: null, wonRevenue: 200, delta: null, attainment: null },
    { period: '2026-06', inProgress: false, basisStatus: 'verified', commitAmount: 300, submittedAt: '2026-06-01T00:00:00Z', wonRevenue: 250, delta: -50, attainment: 83.3 },
  ],
  snapshots: [
    { id: 'synthetic-verified', period: '2026-11', snapshotDate: '2026-11-04T01:00:00Z', basisStatus: 'verified', totalPipeline: 1000, weightedPipeline: 500, aiPredicted: 350 },
    { id: 'synthetic-legacy', period: '2026-10', snapshotDate: '2026-10-04T01:00:00Z', basisStatus: 'unverified', totalPipeline: null, weightedPipeline: null, aiPredicted: null },
  ],
}
