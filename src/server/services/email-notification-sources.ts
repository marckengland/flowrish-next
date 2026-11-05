import 'server-only'
import { Prisma } from '@prisma/client'
import type { LeadAccessFilter } from './access'
export function emailNotificationSources(organizationId: string, userId: string, filter: LeadAccessFilter) {
  const assigned = filter.assignedUserId
  const leadAccess = assigned === undefined ? Prisma.sql`TRUE` : typeof assigned === 'string' ? Prisma.sql`l."assignedUserId"=${assigned}` : assigned.in.length ? Prisma.sql`l."assignedUserId" IN (${Prisma.join(assigned.in)})` : Prisma.sql`FALSE`
  return Prisma.sql`WITH mail AS (
    SELECT m.*,a.provider,a.email AS "mailboxEmail" FROM "EmailMessage" m
    JOIN "EmailAccount" a ON a.id=m."accountId" AND a."organizationId"=${organizationId} AND a."userId"=${userId}
    JOIN "OrganizationMember" member ON member."organizationId"=${organizationId} AND member."userId"=a."userId"
    WHERE m."organizationId"=${organizationId} AND m."leadRouting"->>'ownerId'=${userId}
      AND m."leadRouting"->>'provider'=a.provider AND a.provider IN ('gmail','microsoft')
      AND m."leadRouting"->>'mailboxEmail'=lower(btrim(a.email))
  ), events AS (
    SELECT 'email_match'::text AS kind,m.id AS "messageId",NULL::text AS "followUpId",m."createdAt",NULL::int AS revision FROM mail m WHERE m."leadRouting"->>'state'='PENDING'
    UNION ALL
    SELECT CASE WHEN s.until IS NOT NULL THEN 'follow_up_reminder' ELSE 'email_reply' END,
      CASE WHEN s.until IS NOT NULL THEN NULL ELSE m.id END,f.id,coalesce(s.until,f."createdAt"),s.revision FROM mail m
    JOIN "FollowUpSuggestion" f ON f."organizationId"=${organizationId} AND f."assigneeId"=${userId} AND f."sourceType"='EMAIL' AND f.status='PENDING'
      AND f."sourceId"=m."externalId" AND f."sourceThreadId"=m."threadId"
      AND f."sourceKey"=concat('[',to_json(m.provider),',',to_json(m."accountId"),',',to_json(m."externalId"),']')
    LEFT JOIN "FollowUpSnooze" s ON s."organizationId"=f."organizationId" AND s."userId"=${userId} AND s."followUpId"=f.id
    JOIN "Activity" activity ON activity."emailMessageId"=m.id AND activity."organizationId"=${organizationId} AND activity."leadId"=f."leadId"
    JOIN "Lead" l ON l.id=f."leadId" AND l."organizationId"=${organizationId} AND l."deletedAt" IS NULL AND l."mergedIntoId" IS NULL
    WHERE (s.until IS NULL OR s.until<=timezone('UTC',statement_timestamp()))
      AND (f."taskId" IS NULL OR EXISTS (SELECT 1 FROM "Task" t WHERE t.id=f."taskId" AND t."organizationId"=${organizationId} AND t."leadId"=f."leadId" AND t."assigneeId"=${userId} AND t."isComplete"=false))
      AND m."leadRouting"->>'state'='ROUTED'  AND m."leadRouting"->>'leadId'=l.id AND (${leadAccess})
    UNION ALL
    SELECT 'follow_up_reminder',NULL::text,f.id,s.until,s.revision FROM "FollowUpSnooze" s
    JOIN "FollowUpSuggestion" f ON f.id=s."followUpId" AND f."organizationId"=s."organizationId" AND f."assigneeId"=${userId} AND f."sourceType"='CALL' AND f.status='PENDING'
    JOIN "Task" t ON t.id=f."taskId" AND t."organizationId"=${organizationId} AND t."leadId"=f."leadId" AND t."assigneeId"=${userId} AND t."isComplete"=false
    JOIN "Lead" l ON l.id=f."leadId" AND l."organizationId"=${organizationId} AND l."deletedAt" IS NULL AND l."mergedIntoId" IS NULL
    WHERE s."organizationId"=${organizationId} AND s."userId"=${userId} AND s.until<=timezone('UTC',statement_timestamp()) AND (${leadAccess})
  ), candidates AS (
    SELECT e.*,encode(sha256(convert_to((CASE WHEN e.kind='follow_up_reminder' THEN jsonb_build_array(e.kind,${organizationId}::text,${userId}::text,e."followUpId",e.revision) ELSE jsonb_build_array(e.kind,e."messageId",e."followUpId") END)::text,'UTF8')),'hex') AS key FROM events e
  )`
}
