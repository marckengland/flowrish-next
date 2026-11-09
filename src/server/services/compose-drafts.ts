import 'server-only'
import {createCipheriv,createDecipheriv,createHash,createHmac,hkdfSync,randomBytes} from 'node:crypto'
import {Prisma,type FollowUpComposeDraft} from '@prisma/client'
import {ZodError} from 'zod'
import {prisma} from '@/server/db/client'
import {env} from '@/lib/env'
import {AppError} from '@/lib/errors'
import {composeDraftBinding,composeDraftContent,composeDraftSnapshot,composeDraftWrite,type ComposeDraftBinding,type ComposeDraftContent} from '@/lib/compose-draft'
import {currentFollowUpAccess,followUpLead,followUpUnavailable,requireFollowUpWrites} from './follow-up-access'
const conflict=()=>new AppError('COMPOSE_DRAFT_CONFLICT','A newer saved draft exists. Check it before saving your edits.',409)
const changed=()=>new AppError('COMPOSE_SOURCE_CHANGED','The email source changed. Keep your edits and reopen a current draft before saving or restoring.',409)
const unavailable=()=>new AppError('COMPOSE_DRAFT_UNAVAILABLE','Draft saving is unavailable. Your current edits are kept.',503)
const key=(purpose:'encryption'|'receipt')=>Buffer.from(hkdfSync('sha256',Buffer.from(env.EMAIL_ENCRYPTION_KEY,'hex'),Buffer.from('flowrish-compose-draft-v1'),Buffer.from(purpose),32))
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const aad=(scope:string[],version:string,revision:number)=>Buffer.from(JSON.stringify(['compose-draft',1,...scope,version,revision]))
function encrypt(content:ComposeDraftContent,scope:string[],version:string,revision:number){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key('encryption'),iv);cipher.setAAD(aad(scope,version,revision))
 const bytes=Buffer.concat([cipher.update(JSON.stringify(content),'utf8'),cipher.final()])
 return ['v1',iv.toString('hex'),cipher.getAuthTag().toString('hex'),bytes.toString('hex')].join(':')
}
function decrypt(value:string,scope:string[],version:string,revision:number){
 const parts=value.split(':')
 if(parts.length!==4||parts[0]!=='v1'||!/^[a-f0-9]{24}$/.test(parts[1])||!/^[a-f0-9]{32}$/.test(parts[2])||!/^(?:[a-f0-9]{2})+$/.test(parts[3]))throw unavailable()
 const cipher=createDecipheriv('aes-256-gcm',key('encryption'),Buffer.from(parts[1],'hex'));cipher.setAAD(aad(scope,version,revision));cipher.setAuthTag(Buffer.from(parts[2],'hex'))
 return composeDraftContent.parse(JSON.parse(Buffer.concat([cipher.update(Buffer.from(parts[3],'hex')),cipher.final()]).toString('utf8')))
}
async function safe<T>(action:()=>Promise<T>){try{return await action()}catch(error){if(error instanceof AppError||error instanceof ZodError)throw error;if(error&&typeof error==='object'&&'code'in error&&['P2002','P2034'].includes(String(error.code)))throw conflict();throw unavailable()}}
async function authorized<T>(organizationId:string,userId:string,id:string,rawBinding:unknown,write:boolean,action:(db:Prisma.TransactionClient,scope:{organizationId:string;userId:string;followUpId:string},version:string,subject:string,generated:boolean)=>Promise<T>){
 const binding=composeDraftBinding.parse(rawBinding)
 return safe(()=>prisma.$transaction(async db=>{
  const members=await db.$queryRaw<Array<{id:string}>>(write?Prisma.sql`SELECT id FROM "OrganizationMember" WHERE "organizationId"=${organizationId} AND "userId"=${userId} FOR UPDATE`:Prisma.sql`SELECT id FROM "OrganizationMember" WHERE "organizationId"=${organizationId} AND "userId"=${userId} FOR KEY SHARE`)
  if(!members.length)throw new AppError('FORBIDDEN','Current business membership is required.',403)
  await currentFollowUpAccess(db,organizationId,userId,true)
  const where={id,organizationId,assigneeId:userId},before=await db.followUpSuggestion.findFirst({where})
  if(!before)throw followUpUnavailable()
  await db.$queryRaw`SELECT id FROM "Lead" WHERE id=${before.leadId} AND "organizationId"=${organizationId} FOR SHARE`
  await db.$queryRaw`SELECT id FROM "FollowUpSuggestion" WHERE id=${id} AND "organizationId"=${organizationId} AND "assigneeId"=${userId} FOR SHARE`
  const row=await db.followUpSuggestion.findFirst({where})
  if(!row)throw followUpUnavailable()
  if(row.leadId!==before.leadId)throw changed()
  const {lead}=await followUpLead(db,organizationId,userId,row.leadId,true)
  if(row.sourceType!=='EMAIL'||!['PENDING','APPROVED'].includes(row.status))throw changed()
  const context=row.draftContext as {recipientEmail?:unknown;threadId?:unknown}|null
  const recipient=row.draftVersion?context?.recipientEmail:lead.email,thread=row.draftVersion?context?.threadId:null
  if(binding.leadId!==lead.id||binding.draftVersion!==row.draftVersion||typeof recipient!=='string'||binding.recipientEmail!==recipient.trim().toLowerCase()||binding.threadId!==thread)throw changed()
  const version=hash([organizationId,userId,row.id,row.leadId,row.sourceKey,row.sourceThreadId,row.draftVersion,row.draftSubject,row.draftBody,row.draftContext,recipient])
  return action(db,{organizationId,userId,followUpId:id},version,row.draftSubject,Boolean(row.draftVersion))
 },{timeout:10000}))
}
function snapshot(row:FollowUpComposeDraft|null,scope:{organizationId:string;userId:string;followUpId:string},version:string){
 const outdated=Boolean(row&&row.sourceVersion!==version)
 return composeDraftSnapshot.parse({id:scope.followUpId,sourceVersion:version,revision:row?.revision??0,operationId:row?.operationId??null,updatedAt:row?.updatedAt.toISOString()??null,outdated,content:row?.ciphertext&&!outdated?decrypt(row.ciphertext,[scope.organizationId,scope.userId,scope.followUpId],version,row.revision):null})
}
export async function readComposeDraft(organizationId:string,userId:string,id:string,binding:ComposeDraftBinding){
 return authorized(organizationId,userId,id,binding,false,async(db,scope,version)=>snapshot(await db.followUpComposeDraft.findUnique({where:{organizationId_userId_followUpId:scope}}),scope,version))
}
export async function writeComposeDraft(organizationId:string,userId:string,id:string,raw:unknown){
 const input=composeDraftWrite.parse(raw);requireFollowUpWrites()
 return authorized(organizationId,userId,id,input.binding,true,async(db,scope,version,subject,generated)=>{
  if(input.sourceVersion!==version||generated&&input.content&&input.content.subject!==subject)throw changed()
  const where={organizationId_userId_followUpId:scope},row=await db.followUpComposeDraft.findUnique({where})
  const requestHash=createHmac('sha256',key('receipt')).update(JSON.stringify(['compose-write',1,scope,input])).digest('hex')
  if(row?.operationId===input.operationId){if(row.requestHash!==requestHash)throw conflict();return snapshot(row,scope,version)}
  if((row?.revision??0)!==input.expectedRevision||input.expectedRevision>=2_000_000_000)throw conflict()
  const revision=input.expectedRevision+1,data={...scope,sourceVersion:version,revision,operationId:input.operationId,requestHash,ciphertext:input.content?encrypt(input.content,[organizationId,userId,id],version,revision):null,updatedAt:new Date()}
  if(!row)return snapshot(await db.followUpComposeDraft.create({data}),scope,version)
  if(!(await db.followUpComposeDraft.updateMany({where:{...scope,revision:input.expectedRevision},data})).count)throw conflict()
  return snapshot(data,scope,version)
 })
}
