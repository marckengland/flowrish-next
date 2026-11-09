import 'server-only'
import {createHash,createHmac,hkdfSync,randomUUID} from 'node:crypto'
import {Prisma,type FollowUpSendAttempt} from '@prisma/client'
import {z} from 'zod'
import {prisma} from '@/server/db/client'
import {env} from '@/lib/env'
import {AppError} from '@/lib/errors'
import {emailSendReceipt,emailSendResult,type DeliveryHooks,type EmailSendReceipt} from '@/lib/email-send-result'
import type {EmailAttachment} from './email'
import {currentFollowUpAccess,followUpLead,followUpUnavailable,lockFollowUpMember,requireFollowUpWrites} from './follow-up-access'
const unavailable=()=>new AppError('EMAIL_SEND_STATUS_UNAVAILABLE','The send status is unavailable. Keep your edits and check again before sending.',503)
const unknown=()=>new AppError('EMAIL_SEND_UNKNOWN','The send result is unknown. Check send status and sent mail before continuing. Another send is blocked.',409)
const conflict=()=>new AppError('EMAIL_SEND_CONFLICT','This follow-up already has a send attempt. Check send status before continuing.',409)
const notStarted=()=>new AppError('EMAIL_SEND_NOT_STARTED','The provider send call did not start. Check status before making a new explicit attempt.',409)
const sendInput=z.object({operationId:z.string().uuid().optional(),leadId:z.string().min(1),subject:z.string().min(1),body:z.string().min(1),threadId:z.string().optional(),draftVersion:z.string().optional()}).strict()
type SendInput=z.infer<typeof sendInput>
type Scope={organizationId:string;followUpId:string}
async function safe<T>(action:()=>Promise<T>){try{return await action()}catch(error){if(error instanceof AppError)throw error;throw unavailable()}}
async function access<T>(organizationId:string,userId:string,id:string,write:boolean,action:(db:Prisma.TransactionClient,scope:Scope,leadId:string)=>Promise<T>){
 return safe(()=>prisma.$transaction(async db=>{
  await lockFollowUpMember(db,organizationId,userId)
  await currentFollowUpAccess(db,organizationId,userId,true)
  const where={id,organizationId,assigneeId:userId},before=await db.followUpSuggestion.findFirst({where})
  if(!before)throw followUpUnavailable()
  await db.$queryRaw`SELECT id FROM "Lead" WHERE id=${before.leadId} AND "organizationId"=${organizationId} FOR SHARE`
  await db.$queryRaw(write?Prisma.sql`SELECT id FROM "FollowUpSuggestion" WHERE id=${id} AND "organizationId"=${organizationId} FOR UPDATE`:Prisma.sql`SELECT id FROM "FollowUpSuggestion" WHERE id=${id} AND "organizationId"=${organizationId} FOR SHARE`)
  const row=await db.followUpSuggestion.findFirst({where})
  if(!row||row.leadId!==before.leadId||row.sourceType!=='EMAIL')throw followUpUnavailable()
  await followUpLead(db,organizationId,userId,row.leadId,true)
  return action(db,{organizationId,followUpId:id},row.leadId)
 },{timeout:10000}))
}
function view(id:string,userId:string,row:FollowUpSendAttempt|null){
 if(!row)return emailSendResult.parse({id,state:'NONE',operationId:null,updatedAt:null,result:null})
 if(row.userId!==userId)return emailSendResult.parse({id,state:'UNKNOWN',operationId:null,updatedAt:null,result:null})
 return emailSendResult.parse({id,state:row.state==='CONFIRMED'?'CONFIRMED':row.state==='FAILED'?'FAILED':'UNKNOWN',operationId:row.operationId,updatedAt:row.updatedAt.toISOString(),result:row.state==='CONFIRMED'?emailSendReceipt.parse(row.result):null})
}
export async function readFollowUpSendResult(organizationId:string,userId:string,id:string){return access(organizationId,userId,id,false,async(db,scope)=>view(id,userId,await db.followUpSendAttempt.findUnique({where:{organizationId_followUpId:scope}})))}
function digest(scope:Scope,userId:string,input:SendInput,attachments:readonly EmailAttachment[]){
 const key=Buffer.from(hkdfSync('sha256',Buffer.from(env.EMAIL_ENCRYPTION_KEY,'hex'),Buffer.from('flowrish-send-attempt-v1'),Buffer.from('request-receipt'),32))
 const files=attachments.map(file=>{const bytes=ArrayBuffer.isView(file.data)?Buffer.from(file.data):Buffer.from(file.data);return [file.fileName,file.mimeType,bytes.length,createHash('sha256').update(bytes).digest('hex')]})
 return createHmac('sha256',key).update(JSON.stringify([scope,userId,input.leadId,input.subject,input.body,input.threadId??null,input.draftVersion??null,files])).digest('hex')
}
export async function trackFollowUpSend(organizationId:string,userId:string,id:string,raw:SendInput,attachments:readonly EmailAttachment[],deliver:(hooks:DeliveryHooks)=>Promise<EmailSendReceipt>):Promise<EmailSendReceipt>{
 requireFollowUpWrites()
 const input=sendInput.parse(raw),operationId=input.operationId??randomUUID(),scope={organizationId,followUpId:id},requestHash=digest(scope,userId,input,attachments),where={organizationId_followUpId:scope}
 const reservation=await access(organizationId,userId,id,true,async(db,scope,leadId)=>{
  if(leadId!==input.leadId)throw followUpUnavailable()
  const row=await db.followUpSendAttempt.findUnique({where})
  if(row){
   if(row.userId!==userId)throw conflict()
   if(row.operationId===operationId){
    if(row.requestHash!==requestHash)throw conflict()
    if(row.state==='CONFIRMED')return emailSendReceipt.parse(row.result)
    throw row.state==='FAILED'?notStarted():unknown()
   }
   if(row.state!=='FAILED')throw conflict()
  }
  const data={...scope,userId,operationId,requestHash,state:'PREPARING',result:Prisma.DbNull,updatedAt:new Date()}
  if(row){if(!(await db.followUpSendAttempt.updateMany({where:{...scope,operationId:row.operationId,state:'FAILED'},data})).count)throw conflict()}
  else await db.followUpSendAttempt.create({data})
  return null
 })
 if(reservation)return reservation
 const transition=async(db:Pick<Prisma.TransactionClient,'followUpSendAttempt'>,from:string,to:string,result?:EmailSendReceipt)=>{
  if((await db.followUpSendAttempt.updateMany({where:{...scope,userId,operationId,state:from},data:{state:to,updatedAt:new Date(),...(result?{result}: {})}})).count!==1)throw unavailable()
 }
 const hooks:DeliveryHooks={
  beforeDelivery:()=>access(organizationId,userId,id,true,async(db,_scope,leadId)=>{requireFollowUpWrites();if(leadId!==input.leadId)throw followUpUnavailable();await transition(db,'PREPARING','DISPATCHING')}),
  accepted:async result=>{const receipt=emailSendReceipt.parse(result);await safe(()=>transition(prisma,'DISPATCHING','CONFIRMED',receipt))},
 }
 try{await deliver(hooks)}catch{
  // Only PREPARING proves that the final provider send was never started.
  await safe(()=>prisma.followUpSendAttempt.updateMany({where:{...scope,userId,operationId,state:'PREPARING'},data:{state:'FAILED',updatedAt:new Date()}}))
 }
 const row=await safe(()=>prisma.followUpSendAttempt.findUnique({where}))
 if(!row||row.userId!==userId||row.operationId!==operationId||row.requestHash!==requestHash)throw unknown()
 if(row.state==='CONFIRMED')return emailSendReceipt.parse(row.result)
 throw row.state==='FAILED'?notStarted():unknown()
}
