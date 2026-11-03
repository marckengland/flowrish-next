import 'server-only'
import { Prisma } from '@prisma/client'
export function responseSourcesSql(organizationId: string) {
  return Prisma.sql`SELECT c.id AS "callbackId", 'handoff'::text AS phase, c."createdAt" AS "startedAt", NULL::text AS "taskId", NULL::text AS "assigneeId", NULL::text AS "assigneeName"
    FROM "WebsiteReceptionistCallback" c WHERE c."organizationId"=${organizationId} AND c.status='pending'
      AND NOT EXISTS (SELECT 1 FROM "CallbackCrmHandoff" h WHERE h."organizationId"=${organizationId} AND h."callbackId"=c.id)
    UNION ALL
    SELECT h."callbackId",'attempt',CASE WHEN h."preferredTime"->>'at' IS NOT NULL THEN GREATEST(h."createdAt",t."dueDate") ELSE h."createdAt" END,t.id,t."assigneeId",u.name
    FROM "CallbackCrmHandoff" h JOIN "Task" t ON t.id=h."taskId" AND t."leadId"=h."leadId" AND t."organizationId"=${organizationId}
    JOIN "Lead" l ON l.id=h."leadId" AND l."organizationId"=${organizationId} JOIN "User" u ON u.id=t."assigneeId"
    WHERE h."organizationId"=${organizationId} AND NOT l."isClosed" AND l."deletedAt" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "CallbackOutcomeEvent" e WHERE e."organizationId"=${organizationId} AND e."callbackId"=h."callbackId" AND (e.action='close' OR e.outcome IN ('reached','no_answer')))`
}
/** Only targets from the current policy and current source phase survive. */
export function currentResponseTargetsSql(organizationId: string) {
  return Prisma.sql`SELECT target."callbackId",target.phase,target."startedAt",target."dueAt",target."taskId",source."assigneeId",source."assigneeName",p."backupUserId",p."updatedAt" AS "policyVersion"
    FROM "CallbackResponseTarget" target JOIN "CallbackResponsePolicy" p ON p."organizationId"=target."organizationId" AND p.enabled AND p."updatedAt"=target."policyVersion"
    JOIN (${responseSourcesSql(organizationId)}) source ON source."callbackId"=target."callbackId" AND source.phase=target.phase AND source."startedAt"=target."startedAt" AND source."taskId" IS NOT DISTINCT FROM target."taskId"
    WHERE target."organizationId"=${organizationId}`
}
