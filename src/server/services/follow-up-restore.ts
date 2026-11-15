import 'server-only'
import {createHash} from 'node:crypto'
import {z} from 'zod'
import type {Prisma} from '@prisma/client'
import {prisma} from '@/server/db/client'
import {followUpRestoreInput,followUpRestorePreview,followUpRestoreReceipt} from '@/lib/follow-up-restore'
import {approvalSnapshot} from './follow-up-approval-guard'
import {followUpChanged,followUpLead,followUpUnavailable,lockFollowUpMember,requireFollowUpWrites,safeFollowUp} from './follow-up-access'
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const proofSchema=z.object({restore:z.object({inputHash:z.string(),version:z.string(),taskId:z.string().nullable(),restoredAt:z.string().datetime()}).strict()}).strict()
const auditWhere=(organizationId:string,userId:string,id:string,requestId:string)=>({id:requestId,organizationId,userId,entityType:'FollowUpSuggestion',entityId:id,action:'UPDATE' as const})
async function locked(db:Prisma.TransactionClient,organizationId:string,userId:string,id:string){
 await lockFollowUpMember(db,organizationId,userId)
 const where={id,organizationId,assigneeId:userId},before=await db.followUpSuggestion.findFirst({where})
 if(!before)throw followUpUnavailable()
 await db.$queryRaw`SELECT id FROM "Lead" WHERE id=${before.leadId} AND "organizationId"=${organizationId} FOR SHARE`
 if(before.taskId)await db.$queryRaw`SELECT id FROM "Task" WHERE id=${before.taskId} AND "organizationId"=${organizationId} FOR UPDATE`
 await db.$queryRaw`SELECT id FROM "FollowUpSuggestion" WHERE id=${id} AND "organizationId"=${organizationId} FOR UPDATE`
 const row=await db.followUpSuggestion.findFirst({where})
 if(!row)throw followUpUnavailable()
 if(row.leadId!==before.leadId||row.taskId!==before.taskId||row.sourceType!==before.sourceType||row.sourceId!==before.sourceId)throw followUpChanged()
 const {lead}=await followUpLead(db,organizationId,userId,row.leadId,true),snapshot=await approvalSnapshot(db,row)
 return {row,lead,...snapshot}
}
async function current(db:Prisma.TransactionClient,organizationId:string,userId:string,snapshot:Awaited<ReturnType<typeof locked>>){
 await followUpLead(db,organizationId,userId,snapshot.row.leadId,true)
 return approvalSnapshot(db,snapshot.row)
}
function receipt(id:string,requestId:string,snapshot:Awaited<ReturnType<typeof locked>>,version:string,changes?:unknown){
 const proof=proofSchema.safeParse(changes)
 if(changes===undefined)return followUpRestoreReceipt.parse({id,requestId,state:'not-recorded'})
 if(!proof.success||snapshot.row.status!=='PENDING'||proof.data.restore.version!==version||proof.data.restore.taskId!==snapshot.row.taskId)return followUpRestoreReceipt.parse({id,requestId,state:'changed'})
 return followUpRestoreReceipt.parse({id,requestId,state:'confirmed',taskId:snapshot.row.taskId,restoredAt:proof.data.restore.restoredAt})
}
export async function previewFollowUpRestore(organizationId:string,userId:string,id:string){
 return safeFollowUp(()=>prisma.$transaction(async db=>{
  const snapshot=await locked(db,organizationId,userId,id)
  if(snapshot.row.status!=='DISMISSED')throw followUpChanged()
  const final=await current(db,organizationId,userId,snapshot)
  if(final.version!==snapshot.version)throw followUpChanged()
  const snooze=await db.followUpSnooze.findUnique({where:{organizationId_userId_followUpId:{organizationId,userId,followUpId:id}}})
  return followUpRestorePreview.parse({id,version:final.version,leadName:(snapshot.lead.firstName+' '+snapshot.lead.lastName).trim(),title:snapshot.row.title,task:snapshot.task?{id:snapshot.task.id,title:snapshot.task.title}:null,clearsSnooze:Boolean(snooze?.until)})
 },{timeout:20000}))
}
export async function readFollowUpRestore(organizationId:string,userId:string,id:string,requestId:string){
 z.string().uuid().parse(requestId)
 return safeFollowUp(()=>prisma.$transaction(async db=>{
  const snapshot=await locked(db,organizationId,userId,id),audit=await db.auditEntry.findFirst({where:auditWhere(organizationId,userId,id,requestId),select:{changes:true}})
  const final=await current(db,organizationId,userId,snapshot)
  return receipt(id,requestId,snapshot,final.version,audit?.changes)
 },{timeout:20000}))
}
export async function restoreFollowUp(organizationId:string,userId:string,id:string,raw:unknown){
 const input=followUpRestoreInput.parse(raw);requireFollowUpWrites()
 return safeFollowUp(()=>prisma.$transaction(async db=>{
  const snapshot=await locked(db,organizationId,userId,id),audit=await db.auditEntry.findFirst({where:auditWhere(organizationId,userId,id,input.requestId),select:{changes:true}})
  if(audit){
   const proof=proofSchema.safeParse(audit.changes),final=await current(db,organizationId,userId,snapshot),result=receipt(id,input.requestId,snapshot,final.version,audit.changes)
   if(!proof.success||proof.data.restore.inputHash!==digest(input)||result.state!=='confirmed')throw followUpChanged()
   return result
  }
  if(snapshot.row.status!=='DISMISSED'||snapshot.version!==input.expectedVersion)throw followUpChanged()
  const final=await current(db,organizationId,userId,snapshot);if(final.version!==snapshot.version)throw followUpChanged()
  const changed=await db.followUpSuggestion.updateMany({where:{id,organizationId,assigneeId:userId,status:'DISMISSED',updatedAt:snapshot.row.updatedAt},data:{status:'PENDING'}})
  if(changed.count!==1)throw followUpChanged()
  const key={organizationId_userId_followUpId:{organizationId,userId,followUpId:id}},snooze=await db.followUpSnooze.findUnique({where:key})
  if(snooze?.until){const cleared=await db.followUpSnooze.updateMany({where:{organizationId,userId,followUpId:id,revision:snooze.revision},data:{until:null,revision:{increment:1}}});if(cleared.count!==1)throw followUpChanged()}
  const row=await db.followUpSuggestion.findFirst({where:{id,organizationId,assigneeId:userId}});if(!row||row.status!=='PENDING')throw followUpChanged()
  const after={...snapshot,row,...await approvalSnapshot(db,row)},restoredAt=new Date().toISOString()
  const changes={restore:{inputHash:digest(input),version:after.version,taskId:row.taskId,restoredAt}}
  await db.auditEntry.create({data:{id:input.requestId,organizationId,userId,action:'UPDATE',entityType:'FollowUpSuggestion',entityId:id,changes}})
  const checked=await current(db,organizationId,userId,after),result=receipt(id,input.requestId,after,checked.version,changes)
  if(result.state!=='confirmed')throw followUpChanged()
  return result
 },{timeout:20000}))
}
