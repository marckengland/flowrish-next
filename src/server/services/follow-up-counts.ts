import 'server-only'
import {Prisma} from '@prisma/client'
import {prisma} from '@/server/db/client'
import {AppError} from '@/lib/errors'
import {followUpFilterSchema} from '@/lib/follow-up-filters'
import {filtersForFollowUpTab} from '@/lib/follow-up-task-progress'
import {followUpCountsSchema} from '@/lib/follow-up-counts'
import {currentFollowUpAccess,lockFollowUpMember,safeFollowUp} from './follow-up-access'
import {followUpEligibleSql} from './follow-up-eligibility-sql'
import {followUpFilterSql} from './follow-up-filter-sql'
import {snoozeClock} from './follow-up-snooze'
const unavailable=()=>new AppError('FOLLOW_UP_COUNTS_UNAVAILABLE','Inbox counts could not be verified. Refresh counts to try again.',503)
function total(value:unknown){if(typeof value==='bigint'&&value>=BigInt(0)&&value<=BigInt(Number.MAX_SAFE_INTEGER))return Number(value);if(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0)return value;throw unavailable()}
/** Pure aggregate: no callback materialization, updates, or provider calls. */
export async function readFollowUpCounts(organizationId:string,userId:string,rawFilters:unknown={}){
 const filters=followUpFilterSchema.parse(rawFilters)
 return safeFollowUp(()=>prisma.$transaction(async db=>{
  await lockFollowUpMember(db,organizationId,userId)
  const access=await currentFollowUpAccess(db,organizationId,userId),checkedAt=await snoozeClock(db)
  const now=Prisma.sql`timezone('UTC',${checkedAt}::timestamptz)`
  const match=(status:string)=>followUpFilterSql(filtersForFollowUpTab(filters,status),now)
  const approved=Prisma.sql`status='APPROVED' AND (${match('APPROVED')})`
  const rows=await db.$queryRaw<Array<Record<'PENDING'|'APPROVED'|'DISMISSED'|'SNOOZED'|'overdueTasks',bigint>>>`WITH eligible AS (${followUpEligibleSql(organizationId,userId,access,true)}) SELECT
   COUNT(*) FILTER (WHERE status='PENDING' AND (until IS NULL OR until<=${now}) AND (${match('PENDING')})) AS "PENDING",
   COUNT(*) FILTER (WHERE ${approved}) AS "APPROVED",
   COUNT(*) FILTER (WHERE status='DISMISSED' AND (${match('DISMISSED')})) AS "DISMISSED",
   COUNT(*) FILTER (WHERE status='PENDING' AND until>${now} AND (${match('SNOOZED')})) AS "SNOOZED",
   COUNT(DISTINCT "progressTaskId") FILTER (WHERE ${approved} AND "progressComplete"=false AND "progressDueDate"<${now}) AS "overdueTasks" FROM eligible`
  if(rows.length!==1)throw unavailable()
  const row=rows[0],parsed=followUpCountsSchema.safeParse({counts:{PENDING:total(row.PENDING),APPROVED:total(row.APPROVED),DISMISSED:total(row.DISMISSED),SNOOZED:total(row.SNOOZED)},overdueTasks:total(row.overdueTasks),checkedAt:checkedAt.toISOString(),filters})
  if(!parsed.success)throw unavailable()
  const final=await currentFollowUpAccess(db,organizationId,userId)
  if(JSON.stringify(final.filter)!==JSON.stringify(access.filter)||JSON.stringify(final.taskScope)!==JSON.stringify(access.taskScope))throw new AppError('FOLLOW_UP_CONTEXT_CHANGED','Access changed. Reload before continuing.',409)
  return {data:parsed.data,canWrite:final.canWrite}
 },{timeout:20000}))
}
