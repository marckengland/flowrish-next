import { createTenantPrisma } from '@/server/db/middleware'

/**
 * Dashboard Analytics Service — Pipeline Metrics
 *
 * Computes aggregate metrics used by the Pipeline Metrics tab on the
 * dashboard home page: per-stage pipeline value, conversion rates, stage
 * duration, lead counts, and closed won/lost summary.
 *
 * All queries are tenant-scoped via `createTenantPrisma(orgId)` so the
 * data returned is always limited to the caller's organization.
 *
 * Validates: Requirements 28.1, 28.2, 28.3, 28.4, 28.5, 28.6, 28.7
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Metrics computed per pipeline stage.
 *
 * - `value`: Sum of dealValue across open leads currently in this stage
 *   (Requirement 28.1).
 * - `leadCount`: Number of non-deleted leads currently in the stage
 *   (Requirement 28.4).
 * - `conversionRate`: Fraction of leads that entered this stage and later
 *   moved onward (to any other stage). Always in [0, 1]
 *   (Requirement 28.2; invariant: 0 ≤ rate ≤ 1).
 * - `avgDurationMs`: Mean time in milliseconds between a lead entering
 *   this stage and leaving it. `null` when no leads have exited yet
 *   (Requirement 28.3; invariant: non-negative).
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
 * Closed summary counts over the requested date range.
 * Counts are based on StageTransition records into terminal stages
 * (`isClosedWon` / `isClosedLost`) within `[from, to]` (Requirement 28.5).
 */
export interface ClosedSummary {
  closedWon: number
  closedLost: number
}

/**
 * Full payload powering the Pipeline Metrics tab.
 */
export interface PipelineMetricsReport {
  /** Stages across all of the organization's pipelines, sorted by pipeline then order. */
  stages: StageMetrics[]
  /** Closed won/lost counts for the requested date range. */
  closedSummary: ClosedSummary
  /** The effective date range applied to duration/conversion/closed metrics. */
  dateRange: {
    from: Date
    to: Date
  }
}

/**
 * Optional date range filter for dashboard metrics. Both bounds are
 * inclusive. Defaults to the last 30 days ending now when omitted
 * (Requirement 28.6).
 */
export interface DateRangeInput {
  from?: Date
  to?: Date
}

// ─── Pipeline Metrics ────────────────────────────────────────────────────────

/**
 * Computes the Pipeline Metrics report for an organization.
 *
 * Mechanics:
 * - `value` (per stage): aggregated from open leads (`isClosed=false`,
 *   `deletedAt=null`) currently residing in the stage.
 * - `leadCount` (per stage): count of non-deleted leads currently in the
 *   stage (open or closed). This matches the intuition that a closed-won
 *   stage should still show how many deals ended there.
 * - `conversionRate` (per stage): computed from StageTransition history
 *   filtered to transitions whose entry timestamp falls in `[from, to]`.
 *   For each stage we count how many leads entered it during the window,
 *   then of those how many subsequently left. rate = left / entered
 *   (0 when entered = 0). Guaranteed to be in [0, 1].
 * - `avgDurationMs` (per stage): mean (leave - enter) milliseconds across
 *   leads that both entered and left the stage within the window. `null`
 *   when no qualifying leads exist. Always non-negative by construction —
 *   an entry's timestamp can never exceed its paired exit.
 * - `closedSummary`: counts of transitions INTO a `isClosedWon` /
 *   `isClosedLost` stage within `[from, to]`.
 *
 * Validates: Requirements 28.1, 28.2, 28.3, 28.4, 28.5, 28.6, 28.7
 */
export async function getPipelineMetrics(
  orgId: string,
  range: DateRangeInput = {},
): Promise<PipelineMetricsReport> {
  const db = createTenantPrisma(orgId)

  // Default window: last 30 days ending now. Bounds are inclusive.
  const to = range.to ?? new Date()
  const from =
    range.from ?? new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000)

  // Normalize so `from <= to`. This keeps downstream arithmetic safe and
  // keeps the report's declared range consistent with how filters were
  // actually applied.
  const [lo, hi] = from.getTime() <= to.getTime() ? [from, to] : [to, from]

  // ── Load stages with parent pipeline (sorted for stable output) ────────────
  const pipelines = await db.pipeline.findMany({
    include: {
      stages: {
        orderBy: { order: 'asc' },
      },
    },
  })

  type StageRow = (typeof pipelines)[number]['stages'][number] & {
    pipelineId: string
    pipelineName: string
  }
  const stages: StageRow[] = pipelines.flatMap((p) =>
    p.stages.map((s) => ({
      ...s,
      pipelineId: p.id,
      pipelineName: p.name,
    })),
  )

  if (stages.length === 0) {
    return {
      stages: [],
      closedSummary: { closedWon: 0, closedLost: 0 },
      dateRange: { from: lo, to: hi },
    }
  }

  // ── Per-stage lead counts and pipeline value (open leads) ──────────────────
  // Group open leads by stageId for value totals.
  const valueGroups = await db.lead.groupBy({
    by: ['stageId'],
    where: { isClosed: false, deletedAt: null },
    _sum: { dealValue: true },
  })
  const valueByStage = new Map<string, number>()
  for (const g of valueGroups) {
    // Prisma returns Decimal; coerce via Number for the UI layer.
    valueByStage.set(g.stageId, g._sum.dealValue ? Number(g._sum.dealValue) : 0)
  }

  // Count all non-deleted leads per stage (regardless of open/closed).
  const leadCountGroups = await db.lead.groupBy({
    by: ['stageId'],
    where: { deletedAt: null },
    _count: { _all: true },
  })
  const countByStage = new Map<string, number>()
  for (const g of leadCountGroups) {
    countByStage.set(g.stageId, g._count._all)
  }

  // ── Stage transitions in window (for conversion + duration) ────────────────
  const transitions = await db.stageTransition.findMany({
    where: { transitionedAt: { gte: lo, lte: hi } },
    orderBy: { transitionedAt: 'asc' },
    select: {
      leadId: true,
      fromStageId: true,
      toStageId: true,
      transitionedAt: true,
    },
  })

  // Entries into each stage within the window.
  const enteredByStage = new Map<string, number>()
  // Exits from each stage within the window (i.e., a transition whose
  // `fromStageId` equals the stage).
  const exitedByStage = new Map<string, number>()

  // For duration: pair each entry with the next exit from the same stage
  // for the same lead, restricted to the window. Record entries as we walk.
  type EntryRec = { leadId: string; stageId: string; at: Date }
  const pendingEntries: EntryRec[] = []
  const durationSumByStage = new Map<string, number>()
  const durationCountByStage = new Map<string, number>()

  for (const t of transitions) {
    // Entry into `toStageId`
    enteredByStage.set(
      t.toStageId,
      (enteredByStage.get(t.toStageId) ?? 0) + 1,
    )
    pendingEntries.push({
      leadId: t.leadId,
      stageId: t.toStageId,
      at: t.transitionedAt,
    })

    // Exit from `fromStageId` (may be null for the initial placement).
    if (t.fromStageId) {
      exitedByStage.set(
        t.fromStageId,
        (exitedByStage.get(t.fromStageId) ?? 0) + 1,
      )

      // Pair with the most recent pending entry for this lead+stage.
      // Walk backwards so we match the latest unpaired entry.
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

  // ── Closed summary (transitions INTO terminal stages in window) ────────────
  let closedWon = 0
  let closedLost = 0
  const terminalWon = new Set(
    stages.filter((s) => s.isClosedWon).map((s) => s.id),
  )
  const terminalLost = new Set(
    stages.filter((s) => s.isClosedLost).map((s) => s.id),
  )
  for (const t of transitions) {
    if (terminalWon.has(t.toStageId)) closedWon++
    else if (terminalLost.has(t.toStageId)) closedLost++
  }

  // ── Assemble per-stage metrics ─────────────────────────────────────────────
  const stageMetrics: StageMetrics[] = stages.map((s) => {
    const entered = enteredByStage.get(s.id) ?? 0
    const exited = exitedByStage.get(s.id) ?? 0
    // Clamp to [0, 1] defensively — `exited` can exceed `entered` only if
    // the window slices mid-flight (a lead exited without an in-window
    // entry). In that case conversion is effectively 1.
    const conversionRate =
      entered === 0 ? 0 : Math.min(1, Math.max(0, exited / entered))

    const durSum = durationSumByStage.get(s.id) ?? 0
    const durCount = durationCountByStage.get(s.id) ?? 0
    const avgDurationMs = durCount === 0 ? null : durSum / durCount

    return {
      stageId: s.id,
      stageName: s.name,
      order: s.order,
      isClosedWon: s.isClosedWon,
      isClosedLost: s.isClosedLost,
      pipelineId: s.pipelineId,
      pipelineName: s.pipelineName,
      value: valueByStage.get(s.id) ?? 0,
      leadCount: countByStage.get(s.id) ?? 0,
      conversionRate,
      avgDurationMs,
    }
  })

  return {
    stages: stageMetrics,
    closedSummary: { closedWon, closedLost },
    dateRange: { from: lo, to: hi },
  }
}
