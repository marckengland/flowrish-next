import 'server-only'
import { Prisma } from '@prisma/client'
import { AppError } from '@/lib/errors'
import { performanceQuerySchema, performanceReportSchema, type PerformanceQuery } from '@/lib/callback-performance'
import { prisma } from '@/server/db/client'
import { callbackAccess, callbackRecipientsSql } from './callback-access'
import { currentResponseTargetsSql } from './callback-response-sql'

const ownerFilter = (owner: string) => owner === 'all' ? Prisma.sql`TRUE` : owner === 'unassigned' ? Prisma.sql`"handedOffAt" IS NULL` : Prisma.sql`"assigneeId"=${owner}`
function reportSources(org: string, user: string, query: PerformanceQuery, now: Date) {
  const from = new Date(`${query.from}T00:00:00Z`), until = new Date(Date.parse(`${query.to}T00:00:00Z`) + 86400000)
  return Prisma.sql`WITH authorized AS (${callbackRecipientsSql(org, user)}), sources AS (
    SELECT c.id AS "callbackId",c."createdAt" AS "requestedAt",c.status,h."createdAt" AS "handedOffAt",h."taskId" AS "receiptTaskId",h."leadId"
    FROM "WebsiteReceptionistCallback" c CROSS JOIN authorized a
    LEFT JOIN "CallbackCrmHandoff" h ON h."callbackId"=c.id AND h."organizationId"=${org} AND h."createdAt"<=${now}
    WHERE a.admin AND a.crm AND c."organizationId"=${org} AND c."createdAt">=${from} AND c."createdAt"<${until} AND c."createdAt"<=${now}
    UNION ALL
    SELECT h."callbackId",NULL::timestamp,'deleted',h."createdAt",h."taskId",h."leadId"
    FROM "CallbackCrmHandoff" h CROSS JOIN authorized a WHERE a.admin AND a.crm AND h."organizationId"=${org}
      AND h."createdAt">=${from} AND h."createdAt"<${until} AND h."createdAt"<=${now}
      AND NOT EXISTS (SELECT 1 FROM "WebsiteReceptionistCallback" c WHERE c.id=h."callbackId" AND c."organizationId"=${org})
  ), work AS (
    SELECT s.*, t.id AS "existingTaskId",CASE WHEN m."userId" IS NOT NULL THEN t."assigneeId" END AS "assigneeId",left(u.name,100) AS "assigneeName",
      (t.id IS NOT NULL AND l.id IS NOT NULL AND NOT l."isClosed" AND l."deletedAt" IS NULL) AS available,
      e."firstContactAt",COALESCE(e.closed,false) AS closed,e."latestOutcome"
    FROM sources s LEFT JOIN "Task" t ON t.id=s."receiptTaskId" AND t."leadId"=s."leadId" AND t."organizationId"=${org}
    LEFT JOIN "Lead" l ON l.id=s."leadId" AND l."organizationId"=${org}
    LEFT JOIN "OrganizationMember" m ON m."userId"=t."assigneeId" AND m."organizationId"=${org} LEFT JOIN "User" u ON u.id=m."userId"
    LEFT JOIN LATERAL (
      SELECT min(e."createdAt") FILTER (WHERE e.outcome IN ('reached','no_answer')) AS "firstContactAt",bool_or(e.action='close') AS closed,(array_agg(e.outcome ORDER BY e.sequence DESC))[1] AS "latestOutcome"
      FROM "CallbackOutcomeEvent" e WHERE e."organizationId"=${org} AND e."callbackId"=s."callbackId" AND s."handedOffAt" IS NOT NULL AND e."createdAt">=s."handedOffAt" AND e."createdAt"<=${now}
    ) e ON true
  ), targets AS (${currentResponseTargetsSql(org)}), detailed AS (
    SELECT w.*,(w."handedOffAt" IS NULL AND w.status='pending') AS "waitingHandoff",(w."handedOffAt" IS NOT NULL AND w.available AND w."firstContactAt" IS NULL AND NOT w.closed) AS "waitingContact",
      EXISTS (SELECT 1 FROM targets r WHERE r."callbackId"=w."callbackId" AND r.phase='handoff' AND r."dueAt"<${now}) AS "missedHandoff",
      EXISTS (SELECT 1 FROM targets r WHERE r."callbackId"=w."callbackId" AND r.phase='attempt' AND r."dueAt"<${now}) AS "missedContact",
      (w."handedOffAt" IS NOT NULL AND NOT w.available) AS "unavailableCrm"
    FROM work w
  ), filtered AS (SELECT * FROM detailed WHERE ${ownerFilter(query.owner)}), cohort AS (SELECT * FROM filtered WHERE "requestedAt" IS NOT NULL)`
}
const bucketFilter = (bucket: PerformanceQuery['bucket']) => ({ all: Prisma.sql`TRUE`, handed_off: Prisma.sql`"handedOffAt" IS NOT NULL`, contacted: Prisma.sql`"firstContactAt" IS NOT NULL`, closed: Prisma.sql`closed`, awaiting_handoff: Prisma.sql`"waitingHandoff"`, awaiting_contact: Prisma.sql`"waitingContact"`, missed: Prisma.sql`("missedHandoff" OR "missedContact")`, retained: Prisma.sql`"requestedAt" IS NULL` })[bucket]
interface Totals { requests: number; handedOff: number; contacted: number; closed: number; awaitingHandoff: number; awaitingContact: number; awaitingOwner: number; missedHandoff: number; missedContact: number; unavailableCrm: number; reached: number; noAnswer: number; retry: number; none: number; handoffMedian: number | null; handoffSamples: number; contactMedian: number | null; contactSamples: number; retainedHandoffs: number; retainedMissed: number }
interface Detail { callbackId: string; requestedAt: Date | null; status: string; handedOffAt: Date | null; taskId: string | null; assigneeName: string | null; firstContactAt: Date | null; latestOutcome: string | null; closed: boolean; waitingHandoff: boolean; waitingContact: boolean; missedHandoff: boolean; missedContact: boolean; unavailableCrm: boolean }
export async function getCallbackPerformance(org: string, user: string, raw: unknown) {
  const query = performanceQuerySchema.parse(raw), now = new Date()
  try {
    return await prisma.$transaction(async db => {
      const access = await callbackAccess(org, user, db)
      if (!access.admin || !access.crm) throw new AppError('FORBIDDEN', 'Settings and CRM access are required to view receptionist performance.', 403)
      if (!['all', 'unassigned'].includes(query.owner) && !await db.organizationMember.findUnique({ where: { userId_organizationId: { userId: query.owner, organizationId: org } }, select: { userId: true } })) throw new AppError('VALIDATION_ERROR', 'Choose a current organization owner.', 400)
      const source = reportSources(org, user, query, now)
      const [totals] = await db.$queryRaw<Totals[]>`${source} SELECT count(*)::int AS requests,count(*) FILTER (WHERE "handedOffAt" IS NOT NULL)::int AS "handedOff",count(*) FILTER (WHERE "firstContactAt" IS NOT NULL)::int AS contacted,count(*) FILTER (WHERE closed)::int AS closed,
        count(*) FILTER (WHERE "waitingHandoff")::int AS "awaitingHandoff",count(*) FILTER (WHERE "waitingContact")::int AS "awaitingContact",count(*) FILTER (WHERE "waitingHandoff" OR "waitingContact" AND "assigneeId" IS NULL)::int AS "awaitingOwner",
        count(*) FILTER (WHERE "missedHandoff")::int AS "missedHandoff",count(*) FILTER (WHERE "missedContact")::int AS "missedContact",count(*) FILTER (WHERE "unavailableCrm")::int AS "unavailableCrm",
        count(*) FILTER (WHERE "latestOutcome"='reached')::int AS reached,count(*) FILTER (WHERE "latestOutcome"='no_answer')::int AS "noAnswer",count(*) FILTER (WHERE "latestOutcome"='retry')::int AS retry,count(*) FILTER (WHERE "handedOffAt" IS NOT NULL AND "latestOutcome" IS NULL)::int AS none,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM ("handedOffAt"-"requestedAt"))/60) FILTER (WHERE "handedOffAt">="requestedAt") AS "handoffMedian",count(*) FILTER (WHERE "handedOffAt">="requestedAt")::int AS "handoffSamples",
        percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM ("firstContactAt"-"handedOffAt"))/60) FILTER (WHERE "firstContactAt">="handedOffAt") AS "contactMedian",count(*) FILTER (WHERE "firstContactAt">="handedOffAt")::int AS "contactSamples",
        (SELECT count(*)::int FROM filtered WHERE "requestedAt" IS NULL) AS "retainedHandoffs",(SELECT count(*)::int FROM filtered WHERE "requestedAt" IS NULL AND "missedContact") AS "retainedMissed" FROM cohort`
      const rows = await db.$queryRaw<Detail[]>`${source} SELECT "callbackId","requestedAt",status,"handedOffAt",CASE WHEN available THEN "existingTaskId" END AS "taskId","assigneeName","firstContactAt","latestOutcome",closed,"waitingHandoff","waitingContact","missedHandoff","missedContact","unavailableCrm"
        FROM filtered WHERE ${query.bucket === 'retained' ? Prisma.sql`"requestedAt" IS NULL` : Prisma.sql`"requestedAt" IS NOT NULL AND ${bucketFilter(query.bucket)}`}
        ORDER BY COALESCE("requestedAt","handedOffAt") DESC,"callbackId" DESC LIMIT 21 OFFSET ${(query.page - 1) * 20}`
      const owners = await db.organizationMember.findMany({ where: { organizationId: org }, select: { userId: true, user: { select: { name: true } } }, orderBy: [{ userId: 'asc' }], take: 201 })
      const policy = await db.callbackResponsePolicy.findUnique({ where: { organizationId: org }, select: { enabled: true, lastCheckedAt: true } })
      const { reached, noAnswer, retry, none, handoffMedian, handoffSamples, contactMedian, contactSamples, retainedHandoffs, retainedMissed, ...counts } = totals
      return performanceReportSchema.parse({ asOf: now.toISOString(), filters: query, owners: owners.slice(0, 200).map(row => ({ id: row.userId, name: row.user.name.slice(0, 100) })), ownersTruncated: owners.length > 200, counts, latest: { reached, noAnswer, retry, none }, timing: { handoff: { medianMinutes: handoffMedian, samples: handoffSamples }, contact: { medianMinutes: contactMedian, samples: contactSamples } }, retained: { handoffs: retainedHandoffs, missedContact: retainedMissed }, policy: { enabled: policy?.enabled ?? false, checkedAt: policy?.lastCheckedAt?.toISOString() ?? null }, rows: rows.slice(0, 20).map(row => ({ ...row, requestedAt: row.requestedAt?.toISOString() ?? null, handedOffAt: row.handedOffAt?.toISOString() ?? null, firstContactAt: row.firstContactAt?.toISOString() ?? null })), hasMore: rows.length > 20 })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5000, timeout: 15000 })
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError('PERFORMANCE_UNAVAILABLE', 'Receptionist performance is unavailable. Refresh and try again.', 503)
  }
}
