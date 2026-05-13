import { createTenantPrisma } from '@/server/db/middleware'

/**
 * Dashboard Analytics Service — Pipeline Metrics
 *
 * Provides individual metric functions for the Pipeline Metrics tab on the
 * dashboard: per-stage pipeline value, conversion rates, stage duration,
 * lead counts, and closed won/lost summary.
 *
 * All queries are tenant-scoped via `createTenantPrisma(orgId)` and exclude
 * soft-deleted leads (deletedAt != null).
 *
 * Validates: Requirements 28.1, 28.2, 28.3, 28.4, 28.5, 28.6
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Optional date range filter for dashboard metrics. Both bounds are
 * inclusive. Defaults to the last 30 days ending now when omitted
 * (Requirement 28.6).
 */
export interface DateRangeInput {
  from?: Date
  to?: Date
}

/**
 * Pipeline value per stage — sum of dealValue for non-deleted, open leads.
 * Validates: Requirement 28.1
 */
export interface PipelineValueResult {
  stageId: string
  stageName: string
  order: number
  pipelineId: string
  pipelineName: string
  value: number
}

/**
 * Stage-to-stage conversion rate.
 * Validates: Requirement 28.2
 * Invariant: conversionRate is always in [0, 1].
 */
export interface ConversionRateResult {
  stageId: string
  stageName: string
  order: number
  pipelineId: string
  pipelineName: string
  entered: number
  exited: number
  conversionRate: number
}

/**
 * Average time spent in each stage.
 * Validates: Requirement 28.3
 * Invariant: avgDurationMs is always non-negative (or null if no data).
 */
export interface StageDurationResult {
  stageId: string
  stageName: string
  order: number
  pipelineId: string
  pipelineName: string
  avgDurationMs: number | null
  sampleCount: number
}

/**
 * Lead count per stage.
 * Validates: Requirement 28.4
 */
export interface LeadCountResult {
  stageId: string
  stageName: string
  order: number
  pipelineId: string
  pipelineName: string
  leadCount: number
}

/**
 * Closed won/lost summary counts.
 * Validates: Requirement 28.5
 */
export interface ClosedSummary {
  closedWon: number
  closedLost: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolves the effective date range, defaulting to the last 30 days.
 * Normalizes so from <= to.
 */
function resolveDateRange(range: DateRangeInput = {}): { from: Date; to: Date } {
  const to = range.to ?? new Date()
  const from = range.from ?? new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000)
  // Normalize so from <= to
  return from.getTime() <= to.getTime()
    ? { from, to }
    : { from: to, to: from }
}

/**
 * Loads all stages across all pipelines for the organization, sorted by
 * pipeline then stage order.
 */
async function loadStages(db: ReturnType<typeof createTenantPrisma>) {
  const pipelines = await db.pipeline.findMany({
    include: {
      stages: {
        orderBy: { order: 'asc' },
      },
    },
  })

  return pipelines.flatMap((p) =>
    p.stages.map((s) => ({
      ...s,
      pipelineId: p.id,
      pipelineName: p.name,
    })),
  )
}

// ─── Individual Metric Functions ─────────────────────────────────────────────

/**
 * Calculates total deal value per pipeline stage.
 *
 * Only considers non-deleted, open leads (isClosed=false, deletedAt=null).
 * The dateRange filter is not applied to the value aggregation itself (value
 * reflects the current state of the pipeline), but is returned for
 * consistency with the API contract.
 *
 * Validates: Requirement 28.1, 28.6
 */
export async function getPipelineValue(
  orgId: string,
  dateRange?: DateRangeInput,
): Promise<PipelineValueResult[]> {
  const db = createTenantPrisma(orgId)
  const stages = await loadStages(db)

  if (stages.length === 0) return []

  const { from, to } = resolveDateRange(dateRange)

  // Aggregate deal values for open, non-deleted leads
  // Date range filters leads by createdAt to scope to the period
  const valueGroups = await db.lead.groupBy({
    by: ['stageId'],
    where: {
      isClosed: false,
      deletedAt: null,
      createdAt: { gte: from, lte: to },
    },
    _sum: { dealValue: true },
  })

  const valueByStage = new Map<string, number>()
  for (const g of valueGroups) {
    valueByStage.set(g.stageId, g._sum.dealValue ? Number(g._sum.dealValue) : 0)
  }

  return stages.map((s) => ({
    stageId: s.id,
    stageName: s.name,
    order: s.order,
    pipelineId: s.pipelineId,
    pipelineName: s.pipelineName,
    value: valueByStage.get(s.id) ?? 0,
  }))
}

/**
 * Calculates stage-to-stage conversion rates.
 *
 * Conversion rate = (leads that exited the stage) / (leads that entered the stage)
 * within the date range. Clamped to [0, 1].
 *
 * Validates: Requirement 28.2, 28.6
 * Invariant: conversionRate is always between 0 and 1 (inclusive).
 */
export async function getConversionRates(
  orgId: string,
  dateRange?: DateRangeInput,
): Promise<ConversionRateResult[]> {
  const db = createTenantPrisma(orgId)
  const stages = await loadStages(db)

  if (stages.length === 0) return []

  const { from, to } = resolveDateRange(dateRange)

  // Load transitions within the date range
  const transitions = await db.stageTransition.findMany({
    where: {
      transitionedAt: { gte: from, lte: to },
      lead: { deletedAt: null },
    },
    select: {
      leadId: true,
      fromStageId: true,
      toStageId: true,
    },
  })

  // Count entries and exits per stage
  const enteredByStage = new Map<string, number>()
  const exitedByStage = new Map<string, number>()

  for (const t of transitions) {
    enteredByStage.set(
      t.toStageId,
      (enteredByStage.get(t.toStageId) ?? 0) + 1,
    )
    if (t.fromStageId) {
      exitedByStage.set(
        t.fromStageId,
        (exitedByStage.get(t.fromStageId) ?? 0) + 1,
      )
    }
  }

  return stages.map((s) => {
    const entered = enteredByStage.get(s.id) ?? 0
    const exited = exitedByStage.get(s.id) ?? 0
    // Clamp to [0, 1]
    const conversionRate =
      entered === 0 ? 0 : Math.min(1, Math.max(0, exited / entered))

    return {
      stageId: s.id,
      stageName: s.name,
      order: s.order,
      pipelineId: s.pipelineId,
      pipelineName: s.pipelineName,
      entered,
      exited,
      conversionRate,
    }
  })
}

/**
 * Calculates average time in each stage.
 *
 * For each stage, pairs entry transitions (toStageId = stage) with exit
 * transitions (fromStageId = stage) for the same lead within the date range.
 * Duration = exit timestamp - entry timestamp.
 *
 * Validates: Requirement 28.3, 28.6
 * Invariant: avgDurationMs is always non-negative.
 */
export async function getStageDuration(
  orgId: string,
  dateRange?: DateRangeInput,
): Promise<StageDurationResult[]> {
  const db = createTenantPrisma(orgId)
  const stages = await loadStages(db)

  if (stages.length === 0) return []

  const { from, to } = resolveDateRange(dateRange)

  // Load transitions within the date range, ordered chronologically
  const transitions = await db.stageTransition.findMany({
    where: {
      transitionedAt: { gte: from, lte: to },
      lead: { deletedAt: null },
    },
    orderBy: { transitionedAt: 'asc' },
    select: {
      leadId: true,
      fromStageId: true,
      toStageId: true,
      transitionedAt: true,
    },
  })

  // Track pending entries and compute durations
  type EntryRec = { leadId: string; stageId: string; at: Date }
  const pendingEntries: EntryRec[] = []
  const durationSumByStage = new Map<string, number>()
  const durationCountByStage = new Map<string, number>()

  for (const t of transitions) {
    // Record entry into toStageId
    pendingEntries.push({
      leadId: t.leadId,
      stageId: t.toStageId,
      at: t.transitionedAt,
    })

    // If there's a fromStageId, pair with the most recent pending entry
    if (t.fromStageId) {
      for (let i = pendingEntries.length - 1; i >= 0; i--) {
        const e = pendingEntries[i]
        if (e.leadId === t.leadId && e.stageId === t.fromStageId) {
          const delta = Math.max(0, t.transitionedAt.getTime() - e.at.getTime())
          durationSumByStage.set(
            e.stageId,
            (durationSumByStage.get(e.stageId) ?? 0) + delta,
          )
          durationCountByStage.set(
            e.stageId,
            (durationCountByStage.get(e.stageId) ?? 0) + 1,
          )
          pendingEntries.splice(i, 1)
          break
        }
      }
    }
  }

  return stages.map((s) => {
    const durSum = durationSumByStage.get(s.id) ?? 0
    const durCount = durationCountByStage.get(s.id) ?? 0
    const avgDurationMs = durCount === 0 ? null : durSum / durCount

    return {
      stageId: s.id,
      stageName: s.name,
      order: s.order,
      pipelineId: s.pipelineId,
      pipelineName: s.pipelineName,
      avgDurationMs,
      sampleCount: durCount,
    }
  })
}

/**
 * Calculates lead count per stage.
 *
 * Counts all non-deleted leads currently in each stage. The dateRange
 * filter scopes to leads created within the range.
 *
 * Validates: Requirement 28.4, 28.6
 */
export async function getLeadCounts(
  orgId: string,
  dateRange?: DateRangeInput,
): Promise<LeadCountResult[]> {
  const db = createTenantPrisma(orgId)
  const stages = await loadStages(db)

  if (stages.length === 0) return []

  const { from, to } = resolveDateRange(dateRange)

  // Count non-deleted leads per stage within the date range
  const countGroups = await db.lead.groupBy({
    by: ['stageId'],
    where: {
      deletedAt: null,
      createdAt: { gte: from, lte: to },
    },
    _count: { _all: true },
  })

  const countByStage = new Map<string, number>()
  for (const g of countGroups) {
    countByStage.set(g.stageId, g._count._all)
  }

  return stages.map((s) => ({
    stageId: s.id,
    stageName: s.name,
    order: s.order,
    pipelineId: s.pipelineId,
    pipelineName: s.pipelineName,
    leadCount: countByStage.get(s.id) ?? 0,
  }))
}

/**
 * Calculates closed won/lost summary counts for a given period.
 *
 * Counts transitions INTO terminal stages (isClosedWon / isClosedLost)
 * within the date range. Only considers transitions for non-deleted leads.
 *
 * Validates: Requirement 28.5, 28.6
 */
export async function getClosedSummary(
  orgId: string,
  dateRange?: DateRangeInput,
): Promise<ClosedSummary> {
  const db = createTenantPrisma(orgId)
  const stages = await loadStages(db)

  if (stages.length === 0) return { closedWon: 0, closedLost: 0 }

  const { from, to } = resolveDateRange(dateRange)

  // Identify terminal stage IDs
  const closedWonStageIds = stages
    .filter((s) => s.isClosedWon)
    .map((s) => s.id)
  const closedLostStageIds = stages
    .filter((s) => s.isClosedLost)
    .map((s) => s.id)

  // Count transitions into terminal stages within the date range
  const [closedWon, closedLost] = await Promise.all([
    closedWonStageIds.length > 0
      ? db.stageTransition.count({
          where: {
            toStageId: { in: closedWonStageIds },
            transitionedAt: { gte: from, lte: to },
            lead: { deletedAt: null },
          },
        })
      : 0,
    closedLostStageIds.length > 0
      ? db.stageTransition.count({
          where: {
            toStageId: { in: closedLostStageIds },
            transitionedAt: { gte: from, lte: to },
            lead: { deletedAt: null },
          },
        })
      : 0,
  ])

  return { closedWon, closedLost }
}


// ─── Combined Metrics (backward-compatible) ──────────────────────────────────

/**
 * Metrics computed per pipeline stage (combined view).
 */
export interface StageMetrics {
  stageId: string
  stageName: string
  order: number
  isClosedWon: boolean
  isClosedLost: boolean
  pipelineId: string
  pipelineName: string
  value: number
  leadCount: number
  conversionRate: number
  avgDurationMs: number | null
}

/**
 * Full payload powering the Pipeline Metrics tab.
 */
export interface PipelineMetricsReport {
  stages: StageMetrics[]
  closedSummary: ClosedSummary
  dateRange: {
    from: Date
    to: Date
  }
}

/**
 * Computes the full Pipeline Metrics report for an organization.
 *
 * This is a convenience function that combines all individual metric
 * functions into a single response for the dashboard page.
 *
 * Validates: Requirements 28.1, 28.2, 28.3, 28.4, 28.5, 28.6
 */
export async function getPipelineMetrics(
  orgId: string,
  range: DateRangeInput = {},
): Promise<PipelineMetricsReport> {
  const { from, to } = resolveDateRange(range)
  const dateRangeResolved = { from, to }

  // Fetch all metrics in parallel
  const [pipelineValues, conversionRates, stageDurations, leadCounts, closedSummary] =
    await Promise.all([
      getPipelineValue(orgId, dateRangeResolved),
      getConversionRates(orgId, dateRangeResolved),
      getStageDuration(orgId, dateRangeResolved),
      getLeadCounts(orgId, dateRangeResolved),
      getClosedSummary(orgId, dateRangeResolved),
    ])

  // Merge into a single per-stage view
  // Use pipeline values as the base (it has all stages)
  const stageMap = new Map<string, StageMetrics>()

  for (const pv of pipelineValues) {
    stageMap.set(pv.stageId, {
      stageId: pv.stageId,
      stageName: pv.stageName,
      order: pv.order,
      isClosedWon: false,
      isClosedLost: false,
      pipelineId: pv.pipelineId,
      pipelineName: pv.pipelineName,
      value: pv.value,
      leadCount: 0,
      conversionRate: 0,
      avgDurationMs: null,
    })
  }

  // Enrich with conversion rates
  for (const cr of conversionRates) {
    const existing = stageMap.get(cr.stageId)
    if (existing) {
      existing.conversionRate = cr.conversionRate
    }
  }

  // Enrich with stage durations
  for (const sd of stageDurations) {
    const existing = stageMap.get(sd.stageId)
    if (existing) {
      existing.avgDurationMs = sd.avgDurationMs
    }
  }

  // Enrich with lead counts
  for (const lc of leadCounts) {
    const existing = stageMap.get(lc.stageId)
    if (existing) {
      existing.leadCount = lc.leadCount
    }
  }

  // We need isClosedWon/isClosedLost flags — load stages to get them
  const db = createTenantPrisma(orgId)
  const allStages = await loadStages(db)
  for (const s of allStages) {
    const existing = stageMap.get(s.id)
    if (existing) {
      existing.isClosedWon = s.isClosedWon
      existing.isClosedLost = s.isClosedLost
    }
  }

  // Sort by pipeline then order
  const stages = Array.from(stageMap.values()).sort((a, b) => {
    if (a.pipelineId !== b.pipelineId) {
      return a.pipelineName.localeCompare(b.pipelineName)
    }
    return a.order - b.order
  })

  return {
    stages,
    closedSummary,
    dateRange: dateRangeResolved,
  }
}
