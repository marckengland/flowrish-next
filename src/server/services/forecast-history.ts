import { Prisma } from '@prisma/client'
import { forecastBasis, forecastBasisStatus, type ForecastHistoryReport, type ForecastHistorySnapshot } from '@/lib/forecast-basis'
import { forecastPeriod } from '@/lib/forecast-period'
import { createTenantPrisma } from '@/server/db/middleware'

/** Personal results use current CRM ownership/state, not an immutable ledger. */
export async function getForecastHistory(orgId: string, userId: string, now = new Date()): Promise<ForecastHistoryReport> {
  const db = createTenantPrisma(orgId)
  const currentMonth = new Date(`${forecastPeriod(now)}-01T00:00:00.000Z`)
  const windows = Array.from({ length: 6 }, (_, offset) => {
    const start = new Date(currentMonth)
    start.setUTCMonth(start.getUTCMonth() - offset)
    const end = new Date(start)
    end.setUTCMonth(end.getUTCMonth() + 1)
    return { period: forecastPeriod(start), start, end }
  })
  const periods = windows.map(window => window.period)
  const [submissions, snapshots, ...actuals] = await Promise.all([
    db.forecastSubmission.findMany({
      where: { organizationId: orgId, userId, period: { in: periods } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, period: true, commitAmount: true, createdAt: true, currency: true, reportingTimezone: true, calculationVersion: true, scope: true },
    }),
    db.forecastSnapshot.findMany({
      where: { organizationId: orgId, period: { in: periods }, snapshotDate: { lte: now } },
      orderBy: [{ snapshotDate: 'desc' }, { id: 'desc' }],
      take: 30,
      select: { id: true, period: true, snapshotDate: true, totalPipeline: true, weightedPipeline: true, aiPredicted: true, currency: true, reportingTimezone: true, calculationVersion: true, scope: true },
    }),
    ...windows.map(window => db.lead.aggregate({
      where: { organizationId: orgId, assignedUserId: userId, currency: 'USD', isClosed: true, deletedAt: null, stage: { isClosedWon: true, isClosedLost: false }, closeDate: { gte: window.start, lt: window.end, lte: now } },
      _sum: { dealValue: true },
    })),
  ])
  const months = windows.map((window, index) => {
    const submission = submissions.find(row => row.period === window.period)
    const basisStatus = submission ? forecastBasisStatus(submission, 'OWNER') : 'missing'
    const actual = new Prisma.Decimal(actuals[index]._sum.dealValue ?? 0)
    const commit = basisStatus === 'verified' && submission ? new Prisma.Decimal(submission.commitAmount) : null
    return {
      period: window.period,
      inProgress: index === 0,
      basisStatus,
      commitAmount: commit?.toNumber() ?? null,
      submittedAt: submission?.createdAt?.toISOString() ?? null,
      wonRevenue: actual.toNumber(),
      delta: commit ? actual.minus(commit).toNumber() : null,
      attainment: commit?.gt(0) ? actual.dividedBy(commit).times(100).toDecimalPlaces(1).toNumber() : null,
    } satisfies ForecastHistoryReport['months'][number]
  })
  return {
    ...forecastBasis('OWNER'),
    asOf: now.toISOString(),
    months,
    snapshots: snapshots.map(serializeForecastSnapshot),
  }
}

export function serializeForecastSnapshot(row: {
  id: string; period: string; snapshotDate: Date; totalPipeline: Prisma.Decimal | number | string; weightedPipeline: Prisma.Decimal | number | string; aiPredicted: Prisma.Decimal | number | string
  currency?: string | null; reportingTimezone?: string | null; calculationVersion?: string | null; scope?: string | null
}): ForecastHistorySnapshot {
  const basisStatus = forecastBasisStatus(row, 'ORGANIZATION')
  return {
    id: row.id, period: row.period, snapshotDate: row.snapshotDate.toISOString(), basisStatus,
    totalPipeline: basisStatus === 'verified' ? Number(row.totalPipeline) : null,
    weightedPipeline: basisStatus === 'verified' ? Number(row.weightedPipeline) : null,
    aiPredicted: basisStatus === 'verified' ? Number(row.aiPredicted) : null,
  }
}
