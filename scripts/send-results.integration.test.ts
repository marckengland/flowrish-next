import {randomUUID} from 'node:crypto'
import {writeFileSync} from 'node:fs'
import {afterAll,expect,it,vi} from 'vitest'
vi.mock('@/lib/env',()=>({env:{EMAIL_ENCRYPTION_KEY:'0'.repeat(64)}}))
vi.mock('@/server/db/client',async()=>{const raw=process.env.INBOX_PERF_DATABASE_URL;if(!raw)throw new Error('Explicit disposable database required.');const url=new URL(raw);if(url.protocol!=='postgresql:'||url.hostname!=='127.0.0.1'||url.username!=='postgres'||url.password!=='mock-only'||url.pathname!=='/postgres')throw new Error('Disposable loopback database only.');const {PrismaClient}=await import('@prisma/client');return {prisma:new PrismaClient({datasources:{db:{url:raw}}})}})
import {prisma} from '@/server/db/client'
import {readFollowUpSendResult,trackFollowUpSend} from '@/server/services/email-send-results'
import type {DeliveryHooks} from '@/lib/email-send-result'
const checks:string[]=[],org=randomUUID(),otherOrg=randomUUID(),actor=randomUUID(),other=randomUUID(),followup=randomUUID(),second=randomUUID(),lead=randomUUID(),secondLead=randomUUID(),pipeline=randomUUID(),stage=randomUUID(),role=randomUUID(),team=randomUUID()
const operationId=randomUUID(),input={operationId,leadId:lead,subject:'Synthetic private subject',body:'Synthetic private body'},receipt={messageId:'mock-provider',threadId:'mock-thread',attachmentCount:0}
let deliveries=0
const deliver=async(hooks:DeliveryHooks)=>{deliveries++;await hooks.beforeDelivery();await hooks.accepted(receipt);return receipt}
let baseline:unknown
async function seed(){
 await prisma.organization.createMany({data:[org,otherOrg].map(id=>({id,name:'Synthetic draft business',slug:id}))})
 await prisma.user.createMany({data:[actor,other].map(id=>({id,authId:randomUUID(),email:id+'@example.invalid',name:'Synthetic actor'}))})
 await prisma.organizationMember.createMany({data:[{organizationId:org,userId:actor},{organizationId:org,userId:other},{organizationId:otherOrg,userId:actor}]})
 await prisma.team.create({data:{id:team,organizationId:org,name:'Synthetic team'}})
 await prisma.role.create({data:{id:role,organizationId:org,name:'Synthetic member',hierarchy:3,permissions:{create:[{key:'leads:read'},{key:'leads:write'}]}}})
 await prisma.teamMember.createMany({data:[actor,other].map(userId=>({userId,teamId:team,roleId:role}))})
 await prisma.pipeline.create({data:{id:pipeline,organizationId:org,name:'Synthetic pipeline'}});await prisma.stage.create({data:{id:stage,pipelineId:pipeline,name:'New',order:1}})
 await prisma.lead.createMany({data:[{id:lead,assignedUserId:actor},{id:secondLead,assignedUserId:other}].map(row=>({...row,organizationId:org,stageId:stage,firstName:'Synthetic',lastName:'Contact',email:'lead@example.invalid'}))})
 await prisma.followUpSuggestion.createMany({data:[{id:followup,leadId:lead,assigneeId:actor},{id:second,leadId:secondLead,assigneeId:other}].map(row=>({...row,organizationId:org,sourceKey:row.id,sourceType:'EMAIL',sourceId:row.id,sourceText:'Synthetic source',title:'Review',description:'Notes',draftSubject:'Template',draftBody:'Original'}))})
 baseline={leads:await prisma.lead.findMany({orderBy:{id:'asc'}}),followups:await prisma.followUpSuggestion.findMany({orderBy:{id:'asc'}})}
}
it('serializes actual concurrent reservations and persists acceptance without duplicate delivery',async()=>{
 await seed();let release!:()=>void,entered!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve})
 const first=trackFollowUpSend(org,actor,followup,input,[],async hooks=>{deliveries++;await hooks.beforeDelivery();entered();await new Promise<void>(r=>{release=r});await hooks.accepted(receipt);throw new Error('Synthetic CRM failure after acceptance')})
 await ready
 expect(await readFollowUpSendResult(org,actor,followup)).toMatchObject({state:'UNKNOWN',operationId,result:null})
 await expect(trackFollowUpSend(org,actor,followup,{...input,operationId:randomUUID()},[],deliver)).rejects.toMatchObject({statusCode:409})
 expect(deliveries).toBe(1);release();expect(await first).toEqual(receipt)
 expect(await trackFollowUpSend(org,actor,followup,input,[],deliver)).toEqual(receipt);expect(deliveries).toBe(1)
 const stored=await prisma.followUpSendAttempt.findUniqueOrThrow({where:{organizationId_followUpId:{organizationId:org,followUpId:followup}}})
 expect(stored.state).toBe('CONFIRMED');expect(JSON.stringify(stored)).not.toMatch(/Synthetic private subject|Synthetic private body/)
 await expect(prisma.followUpSendAttempt.create({data:{...stored,organizationId:otherOrg,result:receipt}})).rejects.toMatchObject({code:'P2003'})
 await expect(prisma.$executeRaw`UPDATE "FollowUpSendAttempt" SET state='INVALID' WHERE "organizationId"=${org} AND "followUpId"=${followup}`).rejects.toMatchObject({code:'P2010',meta:{code:'23514'}})
 const protection=await prisma.$queryRaw<Array<{rls:boolean;anon:boolean;authenticated:boolean}>>`SELECT relrowsecurity AS rls,has_table_privilege('anon','"FollowUpSendAttempt"','SELECT,INSERT,UPDATE,DELETE') AS anon,has_table_privilege('authenticated','"FollowUpSendAttempt"','SELECT,INSERT,UPDATE,DELETE') AS authenticated FROM pg_class WHERE oid='"FollowUpSendAttempt"'::regclass`
 expect(protection).toEqual([{rls:true,anon:false,authenticated:false}])
 await expect(prisma.$transaction(async db=>{await db.$executeRawUnsafe('SET LOCAL ROLE anon');return db.$queryRawUnsafe('SELECT * FROM "FollowUpSendAttempt"')})).rejects.toMatchObject({code:'P2010',meta:{code:'42501'}})
 await prisma.$executeRawUnsafe('GRANT SELECT ON "FollowUpSendAttempt" TO anon')
 try{expect(await prisma.$transaction(async db=>{await db.$executeRawUnsafe('SET LOCAL ROLE anon');return db.$queryRawUnsafe('SELECT * FROM "FollowUpSendAttempt"')})).toEqual([])}finally{await prisma.$executeRawUnsafe('REVOKE SELECT ON "FollowUpSendAttempt" FROM anon')}
 checks.push('dispatch-fences')
})
it('retains duplicate protection through membership removal and hides previous-actor result details',async()=>{
 const member=await prisma.organizationMember.findUniqueOrThrow({where:{userId_organizationId:{userId:actor,organizationId:org}}})
 await prisma.organizationMember.delete({where:{id:member.id}})
 expect(await prisma.followUpSendAttempt.count()).toBe(1)
 await expect(readFollowUpSendResult(org,actor,followup)).rejects.toMatchObject({statusCode:403})
 await prisma.organizationMember.create({data:member})
 expect(await readFollowUpSendResult(org,actor,followup)).toMatchObject({state:'CONFIRMED',result:receipt})
 const oldLead=await prisma.lead.findUniqueOrThrow({where:{id:lead}}),oldFollow=await prisma.followUpSuggestion.findUniqueOrThrow({where:{id:followup}})
 await prisma.lead.update({where:{id:lead},data:{assignedUserId:other}});await prisma.followUpSuggestion.update({where:{id:followup},data:{assigneeId:other}})
 expect(await readFollowUpSendResult(org,other,followup)).toEqual({id:followup,state:'UNKNOWN',operationId:null,updatedAt:null,result:null})
 await expect(trackFollowUpSend(org,other,followup,{...input,operationId:randomUUID()},[],deliver)).rejects.toMatchObject({statusCode:409})
 await prisma.lead.update({where:{id:lead},data:{assignedUserId:actor,updatedAt:oldLead.updatedAt}});await prisma.followUpSuggestion.update({where:{id:followup},data:{assigneeId:actor,updatedAt:oldFollow.updatedAt}})
 expect(deliveries).toBe(1);checks.push('privacy-retention')
})
it('retains unknown results and rollback evidence while baseline CRM rows remain unchanged',async()=>{
 const item=await prisma.followUpSuggestion.create({data:{organizationId:org,leadId:lead,assigneeId:actor,sourceKey:randomUUID(),sourceType:'EMAIL',sourceId:randomUUID(),sourceText:'Synthetic timeout',title:'Timeout',description:'Notes'}})
 const unknownInput={...input,operationId:randomUUID()}
 await expect(trackFollowUpSend(org,actor,item.id,unknownInput,[],async hooks=>{await hooks.beforeDelivery();throw new Error('Synthetic provider timeout')})).rejects.toMatchObject({code:'EMAIL_SEND_UNKNOWN'})
 await expect(trackFollowUpSend(org,actor,item.id,unknownInput,[],deliver)).rejects.toMatchObject({code:'EMAIL_SEND_UNKNOWN'})
 expect(await readFollowUpSendResult(org,actor,item.id)).toMatchObject({state:'UNKNOWN',result:null})
 expect((await prisma.followUpSendAttempt.findMany()).every(row=>!JSON.stringify(row).includes(input.body))).toBe(true)
 // Remove only the separately-created synthetic timeout case, not retained baseline evidence.
 await prisma.followUpSuggestion.delete({where:{id:item.id}})
 expect({leads:await prisma.lead.findMany({orderBy:{id:'asc'}}),followups:await prisma.followUpSuggestion.findMany({orderBy:{id:'asc'}})}).toEqual(baseline)
 expect(await prisma.activity.count()).toBe(0);expect(await prisma.emailMessage.count()).toBe(0);expect(await prisma.task.count()).toBe(0)
 expect(await prisma.followUpSendAttempt.count()).toBe(1);expect(await readFollowUpSendResult(org,actor,followup)).toMatchObject({state:'CONFIRMED',result:receipt})
 expect(deliveries).toBe(1);checks.push('rollback')
})
afterAll(async()=>{if(process.env.INBOX_PERF_REPORT)writeFileSync(process.env.INBOX_PERF_REPORT,JSON.stringify({checks}));await prisma.$disconnect()})
