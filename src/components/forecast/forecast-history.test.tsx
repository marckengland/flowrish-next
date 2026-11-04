import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { ForecastHistoryReport } from '@/lib/forecast-basis'
import { ForecastHistory } from './forecast-history'
afterEach(cleanup)
const report: ForecastHistoryReport = {
  currency: 'USD', reportingTimezone: 'UTC', calculationVersion: 'usd-stage-v1', asOf: '2026-11-04T09:00:00Z',
  months: [
    { period: '2026-11', inProgress: true, basisStatus: 'verified', commitAmount: 100, submittedAt: '2026-11-01T00:00:00Z', wonRevenue: 125.50, delta: 25.50, attainment: 125.5 },
    { period: '2026-10', inProgress: false, basisStatus: 'unverified', commitAmount: null, submittedAt: '2026-10-01T00:00:00Z', wonRevenue: 10, delta: null, attainment: null },
  ],
  snapshots: [
    { id: 'verified', period: '2026-11', snapshotDate: '2026-11-04T01:00:00Z', basisStatus: 'verified', totalPipeline: 1000, weightedPipeline: 500, aiPredicted: 350 },
    { id: 'legacy', period: '2026-10', snapshotDate: '2026-10-04T01:00:00Z', basisStatus: 'unverified', totalPipeline: null, weightedPipeline: null, aiPredicted: null },
  ],
}
it('shows personal monthly results, exact cents, current-month status and separate business snapshots', () => {
  render(<ForecastHistory report={report} />)
  const table = screen.getByRole('table', { name: 'Monthly forecast results' })
  expect(within(table).getByText('$125.50')).toBeVisible(); expect(within(table).getByText('+$25.50')).toBeVisible(); expect(within(table).getByText('125.5%')).toBeVisible()
  expect(screen.getByText('Month in progress')).toBeVisible()
  expect(screen.getByText(/Your assigned deals/)).toBeVisible()
  expect(screen.getByText(/reassignment, reopening, or edits/)).toBeVisible()
  expect(screen.getByRole('table', { name: 'Business snapshot history' })).toBeVisible()
})
it('labels legacy money as unverified without inventing differences or currency labels', () => {
  render(<ForecastHistory report={report} />)
  const row = screen.getByText('Unverified commitment').closest('tr')!
  expect(within(row).getAllByText('—')).toHaveLength(3)
  expect(within(row).queryByText(/%/)).not.toBeInTheDocument()
  const snapshot = screen.getByText('Unverified legacy snapshot').closest('tr')!
  expect(within(snapshot).getAllByText('—')).toHaveLength(3)
})
it('offers explicit read-only recovery and handles loading and empty snapshots', () => {
  const view = render(<ForecastHistory report={null} />)
  expect(screen.getByRole('status')).toHaveTextContent('Loading forecast history')
  view.rerender(<ForecastHistory report={null} error />)
  expect(screen.getByRole('alert')).toHaveTextContent('Could not load forecast history')
  expect(screen.getByRole('link', { name: 'Reload history' })).toHaveAttribute('href', '/forecast')
  view.rerender(<ForecastHistory report={{ ...report, snapshots: [] }} />)
  expect(screen.getByText('No business snapshots yet.')).toBeVisible()
})
