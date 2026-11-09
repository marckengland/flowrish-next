import {randomUUID} from 'node:crypto'
import {writeFileSync} from 'node:fs'
import {afterAll,expect,it,vi} from 'vitest'
vi.mock('@/lib/env',()=>({env:{EMAIL_ENCRYPTION_KEY:'0'.repeat(64)}}))
vi.mock('@/server/db/client',async()=>{const raw=process.env.INBOX_PERF_DATABASE_URL;if(!raw)throw new Error('Explicit disposable database required.');const url=new URL(raw);if(url.protocol!=='postgresql:'||url.hostname!=='127.0.0.1'||url.username!=='postgres'||url.password!=='mock-only'||url.pathname!=='/postgres')throw new Error('Disposable loopback database only.');const {PrismaClient}=await import('@prisma/client');return {prisma:new PrismaClient({datasources:{db:{url:raw}}})}})
import {prisma} from '@/server/db/client'
import {listFollowUps} from '@/server/services/follow-ups'
import {readFollowUpCounts} from '@/server/services/follow-up-counts'
import {readSendStatusMetadata} from '@/server/services/follow-up-send-status'
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
it('filters every page and tab count with private send metadata while retaining drafts and blocking retries',async()=>{
 const cases=Array.from({length:205},(_,n)=>({id:randomUUID(),organizationId:org,leadId:lead,assigneeId:actor,sourceKey:randomUUID(),sourceType:'EMAIL',sourceId:randomUUID(),sourceText:'Synthetic inbox status',title:'Older status '+n,description:'Notes',status:n===1?'APPROVED':n===2?'DISMISSED':'PENDING',createdAt:new Date(Date.UTC(2024,0,1,0,0,n))}))
 const excluded=Array.from({length:6},(_,n)=>({...cases[0],id:randomUUID(),sourceKey:randomUUID(),status:'PENDING',createdAt:new Date(Date.UTC(2025,0,1,0,0,n))}))
 const changedOwner={...cases[0],id:randomUUID(),sourceKey:randomUUID()},callback={...cases[0],id:randomUUID(),sourceKey:randomUUID(),sourceType:'CALL',status:'APPROVED'}
 await prisma.followUpSuggestion.createMany({data:[...cases,...excluded,changedOwner,callback]})
 await prisma.followUpSendAttempt.createMany({data:[...cases.map((row,n)=>({organizationId:org,followUpId:row.id,userId:actor,operationId:randomUUID(),requestHash:'a'.repeat(64),state:n%2?'DISPATCHING':'PREPARING'})),{organizationId:org,followUpId:changedOwner.id,userId:other,operationId:randomUUID(),requestHash:'a'.repeat(64),state:'CONFIRMED',result:receipt},{organizationId:org,followUpId:callback.id,userId:actor,operationId:randomUUID(),requestHash:'a'.repeat(64),state:'DISPATCHING'},...excluded.slice(0,4).map((row,n)=>({organizationId:org,followUpId:row.id,userId:actor,operationId:randomUUID(),requestHash:'a'.repeat(64),state:n<2?'FAILED':'CONFIRMED',...(n<2?{}:{result:receipt})})),{organizationId:org,followUpId:second,userId:other,operationId:randomUUID(),requestHash:'a'.repeat(64),state:'DISPATCHING'}]})
 await prisma.followUpSnooze.create({data:{organizationId:org,userId:actor,followUpId:cases[0].id,until:new Date('2099-01-01'),timeZone:'Asia/Manila'}})
 const task=await prisma.task.create({data:{organizationId:org,leadId:lead,assigneeId:actor,title:'Synthetic overdue status task',dueDate:new Date('2000-01-01')}})
 await prisma.followUpSuggestion.update({where:{id:cases[1].id},data:{taskId:task.id}})
 const filters={needsChecking:true},seen=new Set<string>();let after:string|undefined,pages=0
 do{
  const page=await listFollowUps(org,actor,'PENDING',[followup,second],filters,after?{after}:{},false,false,true)
  expect(page.sendStatus).toBe(true);expect(page.items.find(row=>row.id===followup)?.sendStatus).toMatchObject({state:'CONFIRMED'});expect(page.items.some(row=>row.id===second)).toBe(false)
  expect(JSON.stringify(page.items)).not.toMatch(/requestHash|operationId|mock-provider|mock-thread/)
  for(const item of page.items)if(item.id!==followup){expect(item.sendStatus?.state).toBe('UNKNOWN');expect(seen.has(item.id)).toBe(false);seen.add(item.id)}
  after=page.page?.nextCursor??undefined;pages++
 }while(after&&pages<5)
 expect(pages).toBe(3);expect(seen.size).toBe(203);expect(seen.has(changedOwner.id)).toBe(true)
 expect((await readFollowUpCounts(org,actor,filters)).data).toMatchObject({counts:{PENDING:203,APPROVED:1,DISMISSED:1,SNOOZED:1},overdueTasks:1,filters:{needsChecking:true}})
 const approved=await listFollowUps(org,actor,'APPROVED',[],{needsChecking:true,taskProgress:'OVERDUE',taskOrder:'DUE_ASC'},{},true,true,true)
 expect(approved.items).toHaveLength(1);expect(approved.items[0].id).toBe(cases[1].id);expect(approved.items[0].taskProgress?.state).toBe('OVERDUE')
 expect((await listFollowUps(org,actor,'PENDING',[],{needsChecking:true,source:'CALL'},{},false,false,true)).items).toEqual([])
 const first=await listFollowUps(org,actor,'PENDING',[],filters,{},false,false,true)
 await expect(listFollowUps(org,actor,'PENDING',[],{}, {after:first.page!.nextCursor!},false,false,true)).rejects.toMatchObject({code:'FOLLOW_UP_PAGE_CHANGED'})
 await expect(trackFollowUpSend(org,actor,cases[3].id,{...input,operationId:randomUUID()},[],deliver)).rejects.toMatchObject({code:'EMAIL_SEND_CONFLICT'})
 expect(deliveries).toBe(1)
 const permission=await prisma.rolePermission.findFirstOrThrow({where:{roleId:role,key:'leads:write'}});await prisma.rolePermission.delete({where:{id:permission.id}})
 try{await expect(readFollowUpCounts(org,actor,filters)).rejects.toMatchObject({statusCode:403});await expect(listFollowUps(org,actor,'PENDING',[],filters,{},false,false,true)).rejects.toMatchObject({statusCode:403});const readOnly=await listFollowUps(org,actor,'PENDING',[],{}, {},false,false,true);expect(readOnly.sendStatus).toBeUndefined();expect(readOnly.items.every(row=>row.sendStatus===undefined)).toBe(true)}finally{await prisma.rolePermission.create({data:permission})}
 expect(await prisma.activity.count()).toBe(0);expect(await prisma.emailMessage.count()).toBe(0)
 const raceLead=await prisma.lead.create({data:{organizationId:org,stageId:stage,assignedUserId:actor,firstName:'Synthetic',lastName:'Scope race',email:'race@example.invalid'}})
 const race=await prisma.followUpSuggestion.create({data:{organizationId:org,leadId:raceLead.id,assigneeId:actor,sourceKey:randomUUID(),sourceType:'EMAIL',sourceId:randomUUID(),sourceText:'Scope race',title:'Race',description:'Notes'}})
 await prisma.followUpSendAttempt.create({data:{organizationId:org,followUpId:race.id,userId:actor,operationId:randomUUID(),requestHash:'b'.repeat(64),state:'DISPATCHING'}})
 let entered!:()=>void,release!:()=>void;const locked=new Promise<void>(r=>{entered=r}),gate=new Promise<void>(r=>{release=r})
 const writer=prisma.$transaction(async db=>{await db.lead.update({where:{id:raceLead.id},data:{assignedUserId:other}});entered();await gate},{timeout:10000})
 await locked
 const selected=[{id:race.id,leadId:raceLead.id}],filter={deletedAt:null,assignedUserId:actor} as const
 try{await expect(prisma.$transaction(db=>readSendStatusMetadata(db,org,actor,selected,filter))).rejects.toMatchObject({code:'P2010',meta:{code:'55P03'}})}finally{release();await writer}
 await expect(prisma.$transaction(db=>readSendStatusMetadata(db,org,actor,selected,filter))).rejects.toMatchObject({statusCode:404})
 await prisma.followUpSuggestion.delete({where:{id:race.id}});await prisma.lead.delete({where:{id:raceLead.id}})
 checks.push('status-inbox')
})
afterAll(async()=>{if(process.env.INBOX_PERF_REPORT)writeFileSync(process.env.INBOX_PERF_REPORT,JSON.stringify({checks}));await prisma.$disconnect()})
