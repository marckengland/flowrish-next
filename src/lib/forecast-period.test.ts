import { expect, it } from 'vitest'
import { forecastPeriod } from './forecast-period'
it('uses one UTC reporting month at Manila and western-local month boundaries', () => {
  expect(forecastPeriod(new Date('2026-12-01T00:30:00+08:00'))).toBe('2026-11')
  expect(forecastPeriod(new Date('2026-11-30T23:30:00-08:00'))).toBe('2026-12')
  expect(forecastPeriod(new Date('2026-12-01T00:00:00Z'))).toBe('2026-12')
})
