import { FORECAST_CURRENCY } from './money'

export const FORECAST_TIMEZONE = 'UTC'
export const FORECAST_CALCULATION_VERSION = 'usd-stage-v1'
export type ForecastScope = 'OWNER' | 'ORGANIZATION'
export type ForecastBasisStatus = 'verified' | 'unverified' | 'incompatible'
export interface ForecastBasisFields {
  currency?: string | null
  reportingTimezone?: string | null
  calculationVersion?: string | null
  scope?: string | null
}

export function forecastBasis(scope: ForecastScope) {
  return { currency: FORECAST_CURRENCY, reportingTimezone: FORECAST_TIMEZONE, calculationVersion: FORECAST_CALCULATION_VERSION, scope }
}

export function forecastBasisStatus(record: ForecastBasisFields, scope: ForecastScope): ForecastBasisStatus {
  const expected = forecastBasis(scope)
  const keys = Object.keys(expected) as Array<keyof typeof expected>
  if (keys.some(key => !record[key])) return 'unverified'
  return keys.every(key => record[key] === expected[key]) ? 'verified' : 'incompatible'
}

export interface ForecastMonthResult {
  period: string
  inProgress: boolean
  basisStatus: ForecastBasisStatus | 'missing'
  commitAmount: number | null
  submittedAt: string | null
  wonRevenue: number
  delta: number | null
  attainment: number | null
}

export interface ForecastHistorySnapshot {
  id: string
  period: string
  snapshotDate: string
  basisStatus: ForecastBasisStatus
  totalPipeline: number | null
  weightedPipeline: number | null
  aiPredicted: number | null
}

export interface ForecastHistoryReport {
  currency: string
  reportingTimezone: string
  calculationVersion: string
  asOf: string
  months: ForecastMonthResult[]
  snapshots: ForecastHistorySnapshot[]
}
