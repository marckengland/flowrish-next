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
    SELECT 'email_match'::text AS kind,m.id AS "messageId",NULL::text AS "followUpId",m."createdAt" FROM mail m WHERE m."leadRouting"->>'state'='PENDING'
    UNION ALL
    SELECT 'email_reply',m.id,f.id,f."createdAt" FROM mail m
    JOIN "FollowUpSuggestion" f ON f."organizationId"=${organizationId} AND f."assigneeId"=${userId} AND f."sourceType"='EMAIL' AND f.status='PENDING'
      AND f."sourceId"=m."externalId" AND f."sourceThreadId"=m."threadId"
      AND f."sourceKey"=concat('[',to_json(m.provider),',',to_json(m."accountId"),',',to_json(m."externalId"),']')
    JOIN "Activity" activity ON activity."emailMessageId"=m.id AND activity."organizationId"=${organizationId} AND activity."leadId"=f."leadId"
    JOIN "Lead" l ON l.id=f."leadId" AND l."organizationId"=${organizationId} AND l."deletedAt" IS NULL AND l."mergedIntoId" IS NULL
    WHERE m."leadRouting"->>'state'='ROUTED' AND m."leadRouting"->>'leadId'=l.id AND (${leadAccess})
  ), candidates AS (
    SELECT e.*,encode(sha256(convert_to(jsonb_build_array(e.kind,e."messageId",e."followUpId")::text,'UTF8')),'hex') AS key FROM events e
  )`
}
