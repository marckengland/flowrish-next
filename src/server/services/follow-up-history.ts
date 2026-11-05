import 'server-only'
import { z } from 'zod'
import { prisma } from '@/server/db/client'
import { followUpHistoryData, followUpHistoryQuery, type FollowUpHistoryData } from '@/lib/follow-up-history'
import { currentFollowUpAccess, followUpChanged, followUpLead, followUpUnavailable, lockFollowUpMember, safeFollowUp } from './follow-up-access'
import { snoozeClock, snoozeView } from './follow-up-snooze'
const review = z.object({ status: z.enum(['APPROVED','DISMISSED']) })
const snooze = z.discriminatedUnion('action', [z.object({ action: z.literal('snooze'), until: z.string().datetime(), timeZone: z.string().min(1).max(100) }),z.object({ action: z.literal('wake'), until: z.null(), timeZone: z.string().min(1).max(100) })])
export async function listFollowUpHistory(organizationId: string, userId: string, id: string, raw: unknown) {
  const input = followUpHistoryQuery.parse(raw)
  return safeFollowUp(() => prisma.$transaction(async db => {
    await lockFollowUpMember(db,organizationId,userId)
    const authorized = async () => {
      await currentFollowUpAccess(db,organizationId,userId)
      const row = await db.followUpSuggestion.findFirst({ where: { id,organizationId,assigneeId:userId } })
      if (!row || !['PENDING','APPROVED','DISMISSED'].includes(row.status)) throw followUpUnavailable()
      const { access } = await followUpLead(db,organizationId,userId,row.leadId)
      if (row.sourceType==='CALL' && !row.taskId) throw followUpUnavailable()
      if (row.taskId && !await db.task.findFirst({ where: { id:row.taskId,organizationId,leadId:row.leadId,assigneeId:userId,...(row.status==='PENDING'?{isComplete:false}:{}) } })) throw followUpUnavailable()
      return { row,access }
    }
    const before = await authorized(), key = { organizationId_userId_followUpId: {organizationId,userId,followUpId:id} }, oldSnooze = await db.followUpSnooze.findUnique({where:key})
    const scanned = await db.auditEntry.findMany({ where: {organizationId,userId,entityId:id,action:'UPDATE',entityType:{in:['FollowUpSuggestion','FollowUpSnooze']}},orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(input.page-1)*20,take:21,select:{id:true,entityType:true,changes:true,createdAt:true} })
    const final = await authorized(), saved = await db.followUpSnooze.findUnique({where:key})
    if (snoozeView(before.row,oldSnooze).snoozeVersion !== snoozeView(final.row,saved).snoozeVersion) throw followUpChanged()
    const now = await snoozeClock(db), pending = final.row.status==='PENDING', until = pending ? saved?.until ?? null : null
    const state = !pending ? final.row.status==='APPROVED'?'approved':'dismissed' : until ? until<=now?'due':'snoozed' : 'pending'
    const entries = scanned.slice(0,20).flatMap<FollowUpHistoryData['entries'][number]>(entry => {
      const reviewed = entry.entityType==='FollowUpSuggestion' ? review.safeParse(entry.changes) : null
      const snoozed = entry.entityType==='FollowUpSnooze' ? snooze.safeParse(entry.changes) : null
      const base = {id:entry.id,actor:'You' as const,occurredAt:entry.createdAt.toISOString()}
      if (reviewed?.success) return [{...base,kind:reviewed.data.status==='APPROVED'?'approved' as const:'dismissed' as const,until:null,timeZone:null}]
      if (snoozed?.success) return [{...base,kind:snoozed.data.action==='snooze'?'snoozed' as const:'woke' as const,until:snoozed.data.until,timeZone:snoozed.data.timeZone}]
      return []
    })
    return { data:followUpHistoryData.parse({id,page:input.page,hasMore:scanned.length>20,entries,current:{state,until:until?.toISOString()??null,timeZone:until?saved!.timeZone:null,checkedAt:now.toISOString()}}),canWrite:final.access.canWrite }
  },{timeout:20000}))
}
