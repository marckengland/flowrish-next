import 'server-only'
import {Prisma} from '@prisma/client'
import type {LeadAccessFilter} from './access'
import {followUpUnavailable} from './follow-up-access'
import {sendStatusMetadataSchema,type SendStatusMetadata} from '@/lib/follow-up-send-status'
/** Recheck a bounded authorized batch under non-waiting row locks; select no receipt fields. */
export async function readSendStatusMetadata(db:Prisma.TransactionClient,organizationId:string,userId:string,selected:readonly {id:string;leadId:string}[],filter:LeadAccessFilter){
 const ids=selected.map(row=>row.id)
 const values=new Map<string,SendStatusMetadata>(ids.map(id=>[id,{state:'NONE',updatedAt:null}]))
 if(!ids.length)return values
 const leadIds=[...new Set(selected.map(row=>row.leadId))].sort(),orderedIds=[...ids].sort()
 await db.$queryRaw`SELECT id FROM "Lead" WHERE "organizationId"=${organizationId} AND id IN (${Prisma.join(leadIds)}) ORDER BY id FOR SHARE NOWAIT`
 await db.$queryRaw`SELECT id FROM "FollowUpSuggestion" WHERE "organizationId"=${organizationId} AND id IN (${Prisma.join(orderedIds)}) ORDER BY id FOR SHARE NOWAIT`
 const current=await db.followUpSuggestion.findMany({where:{organizationId,assigneeId:userId,id:{in:ids}},select:{id:true,leadId:true,sourceType:true}}),before=new Map(selected.map(row=>[row.id,row.leadId]))
 if(current.length!==ids.length||current.some(row=>row.sourceType!=='EMAIL'||before.get(row.id)!==row.leadId))throw followUpUnavailable()
 const leads=await db.lead.findMany({where:{organizationId,id:{in:leadIds},mergedIntoId:null,AND:[filter]},select:{id:true}})
 if(leads.length!==leadIds.length)throw followUpUnavailable()
 const rows=await db.followUpSendAttempt.findMany({where:{organizationId,followUpId:{in:[...ids]}},select:{followUpId:true,userId:true,state:true,updatedAt:true}})
 for(const row of rows){if(!values.has(row.followUpId))continue;values.set(row.followUpId,sendStatusMetadataSchema.parse(row.userId!==userId?{state:'UNKNOWN',updatedAt:null}:{state:row.state==='CONFIRMED'?'CONFIRMED':row.state==='FAILED'?'FAILED':'UNKNOWN',updatedAt:row.updatedAt.toISOString()}))}
 return values
}
