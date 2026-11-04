import { expect, it } from 'vitest'
import { forecastBasis, forecastBasisStatus } from './forecast-basis'

it('records an explicit reporting basis and rejects missing or mismatched metadata', () => {
  expect(forecastBasis('OWNER')).toEqual({ currency: 'USD', reportingTimezone: 'UTC', calculationVersion: 'usd-stage-v1', scope: 'OWNER' })
  expect(forecastBasisStatus({}, 'OWNER')).toBe('unverified')
  for (const field of ['currency', 'reportingTimezone', 'calculationVersion', 'scope']) {
    expect(forecastBasisStatus({ ...forecastBasis('OWNER'), [field]: null }, 'OWNER')).toBe('unverified')
    expect(forecastBasisStatus({ ...forecastBasis('OWNER'), [field]: 'other' }, 'OWNER')).toBe('incompatible')
  }
  expect(forecastBasisStatus(forecastBasis('ORGANIZATION'), 'OWNER')).toBe('incompatible')
  expect(forecastBasisStatus(forecastBasis('ORGANIZATION'), 'ORGANIZATION')).toBe('verified')
})
