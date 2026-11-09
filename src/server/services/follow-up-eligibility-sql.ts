import 'server-only'
import {Prisma} from '@prisma/client'
import type {LeadAccessFilter} from './access'
type Access={filter:LeadAccessFilter;taskScope:{assigneeId?:string}}
export function followUpLeadScope(access:Access){const assigned=access.filter.assignedUserId;return assigned===undefined?Prisma.sql`TRUE`:typeof assigned==='string'?Prisma.sql`l."assignedUserId"=${assigned}`:assigned.in.length?Prisma.sql`l."assignedUserId" IN (${Prisma.join(assigned.in)})`:Prisma.sql`FALSE`}
/** Shared list/count visibility. This builder performs no reads or writes. */
export function followUpEligibleSql(organizationId:string,userId:string,access:Access,progressMode:boolean,needsChecking=false){
 const sendField=needsChecking?Prisma.sql`,(f."sourceType"='EMAIL' AND EXISTS (SELECT 1 FROM "FollowUpSendAttempt" a WHERE a."organizationId"=f."organizationId" AND a."followUpId"=f.id AND (a."userId"<>${userId} OR a.state IN ('PREPARING','DISPATCHING')))) AS "needsChecking"`:Prisma.empty
 const progressFields=progressMode?Prisma.sql`,pt.id AS "progressTaskId",pt."dueDate" AS "progressDueDate",pt."isComplete" AS "progressComplete"`:Prisma.empty
 const progressJoin=progressMode?Prisma.sql`LEFT JOIN "Task" pt ON pt.id=f."taskId" AND pt."organizationId"=f."organizationId" AND pt."leadId"=f."leadId" AND (${access.taskScope.assigneeId?Prisma.sql`pt."assigneeId"=${access.taskScope.assigneeId}`:Prisma.sql`TRUE`})`:Prisma.empty
 return Prisma.sql`SELECT f.id,f."createdAt",f.status,s.until,f."sourceType",concat_ws(' ',l."firstName",l."lastName",l.email,f.title) AS "searchText"${progressFields}${sendField} FROM "FollowUpSuggestion" f
 LEFT JOIN "FollowUpSnooze" s ON s."organizationId"=f."organizationId" AND s."userId"=${userId} AND s."followUpId"=f.id
 JOIN "Lead" l ON l.id=f."leadId" AND l."organizationId"=${organizationId}
 ${progressJoin}
 WHERE f."organizationId"=${organizationId} AND f."assigneeId"=${userId}
 AND l."deletedAt" IS NULL AND l."mergedIntoId" IS NULL AND (${followUpLeadScope(access)})
 AND (f.status<>'PENDING' OR (f."taskId" IS NULL AND f."sourceType"<>'CALL') OR EXISTS (
 SELECT 1 FROM "Task" t WHERE t.id=f."taskId" AND t."organizationId"=${organizationId}
 AND t."assigneeId"=${userId} AND t."leadId"=f."leadId" AND t."isComplete"=false))`
}
