import { describe, expect, it } from 'vitest'
import { defaultPerformanceDates, performanceQuerySchema, elapsedLabel } from './callback-performance'

describe('callback performance query boundaries', () => {
  it('defaults to thirty inclusive UTC dates across year and leap boundaries', () => {
    expect(defaultPerformanceDates(new Date('2027-01-02T00:01:00Z'))).toEqual({ from: '2026-12-04', to: '2027-01-02' })
    expect(defaultPerformanceDates(new Date('2024-03-01T23:59:59Z'))).toEqual({ from: '2024-02-01', to: '2024-03-01' })
    expect(performanceQuerySchema.parse({ from: '2024-02-29', to: '2024-02-29' })).toEqual({ from: '2024-02-29', to: '2024-02-29', owner: 'all', bucket: 'all', page: 1 })
  })
  it('rejects impossible dates, reversed or unbounded ranges and forged filters', () => {
    const valid = { from: '2024-01-01', to: '2024-12-31' }
    expect(performanceQuerySchema.safeParse(valid).success).toBe(true)
    for (const change of [{ from: '2024-02-30' }, { from: '2023-02-29' }, { to: '2025-01-01' }, { from: '2025-01-01' }, { from: '24-01-01' }, { owner: "x' OR true" }, { bucket: 'invented' }, { page: 0 }, { page: 10001 }, { organizationId: 'foreign' }]) expect(performanceQuerySchema.safeParse({ ...valid, ...change }).success).toBe(false)
  })
  it('distinguishes missing samples from zero and labels elapsed time honestly', () => {
    expect(elapsedLabel(null)).toBe('No samples')
    expect(elapsedLabel(0)).toBe('0 min')
    expect(elapsedLabel(90)).toBe('1.5 hr')
    expect(elapsedLabel(2880)).toBe('2 days')
  })
})
