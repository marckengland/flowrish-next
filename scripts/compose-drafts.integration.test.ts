import {randomUUID} from 'node:crypto'
import {writeFileSync} from 'node:fs'
import {afterAll,expect,it,vi} from 'vitest'
vi.mock('@/lib/env',()=>({env:{EMAIL_ENCRYPTION_KEY:'0'.repeat(64)}}))
vi.mock('@/server/db/client',async()=>{const raw=process.env.INBOX_PERF_DATABASE_URL;if(!raw)throw new Error('Explicit disposable database required.');const url=new URL(raw);if(url.protocol!=='postgresql:'||url.hostname!=='127.0.0.1'||url.username!=='postgres'||url.password!=='mock-only'||url.pathname!=='/postgres')throw new Error('Disposable loopback database only.');const {PrismaClient}=await import('@prisma/client');return {prisma:new PrismaClient({datasources:{db:{url:raw}}})}})
import {prisma} from '@/server/db/client'
import {readComposeDraft,writeComposeDraft} from '@/server/services/compose-drafts'
const checks:string[]=[],org=randomUUID(),otherOrg=randomUUID(),actor=randomUUID(),other=randomUUID(),followup=randomUUID(),second=randomUUID(),lead=randomUUID(),secondLead=randomUUID(),pipeline=randomUUID(),stage=randomUUID(),role=randomUUID(),team=randomUUID()
const binding={leadId:lead,recipientEmail:'lead@example.invalid',draftVersion:null,threadId:null},content={subject:'Synthetic private subject',body:'<p>Synthetic private body</p>'}
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
it('enforces real scoped foreign keys, encrypted recovery, denied client grants and default-deny RLS',async()=>{
 await seed();const state=await readComposeDraft(org,actor,followup,binding),saved=await writeComposeDraft(org,actor,followup,{operationId:randomUUID(),expectedRevision:0,sourceVersion:state.sourceVersion,binding,content});expect(saved.content).toEqual(content)
 const stored=await prisma.followUpComposeDraft.findFirstOrThrow();expect(stored.ciphertext).not.toContain('Synthetic private');expect((await readComposeDraft(org,actor,followup,binding)).content).toEqual(content)
 await expect(readComposeDraft(org,other,followup,binding)).rejects.toMatchObject({statusCode:404})
 await expect(prisma.followUpComposeDraft.create({data:{...stored,organizationId:otherOrg}})).rejects.toMatchObject({code:'P2003'})
 await expect(prisma.$executeRaw`UPDATE "FollowUpComposeDraft" SET revision=0 WHERE "organizationId"=${org}`).rejects.toMatchObject({code:'P2010',meta:{code:'23514'}})
 const [access]=await prisma.$queryRaw<Array<{rls:boolean;anon:boolean;authenticated:boolean}>>`SELECT relrowsecurity AS rls,has_table_privilege('anon','public."FollowUpComposeDraft"','SELECT,INSERT,UPDATE,DELETE') AS anon,has_table_privilege('authenticated','public."FollowUpComposeDraft"','SELECT,INSERT,UPDATE,DELETE') AS authenticated FROM pg_class WHERE oid='public."FollowUpComposeDraft"'::regclass`
 expect(access).toEqual({rls:true,anon:false,authenticated:false})
 await expect(prisma.$transaction(async db=>{await db.$executeRawUnsafe('SET LOCAL ROLE anon');return db.$queryRawUnsafe('SELECT * FROM "FollowUpComposeDraft"')})).rejects.toMatchObject({code:'P2010',meta:{code:'42501'}})
 await prisma.$executeRawUnsafe('GRANT SELECT ON "FollowUpComposeDraft" TO anon')
 try{expect(await prisma.$transaction(async db=>{await db.$executeRawUnsafe('SET LOCAL ROLE anon');return db.$queryRawUnsafe('SELECT * FROM "FollowUpComposeDraft"')})).toEqual([])}finally{await prisma.$executeRawUnsafe('REVOKE SELECT ON "FollowUpComposeDraft" FROM anon')}
 checks.push('encrypted-scope')
})
it('serializes concurrent compare-and-swap writes, replays exact receipts, and fences cleared tombstones',async()=>{
 const state=await readComposeDraft(org,actor,followup,binding),input={operationId:randomUUID(),expectedRevision:state.revision,sourceVersion:state.sourceVersion,binding,content:{subject:'Concurrent one',body:'First body'}}
 const results=await Promise.allSettled([writeComposeDraft(org,actor,followup,input),writeComposeDraft(org,actor,followup,{...input,operationId:randomUUID(),content:{subject:'Concurrent two',body:'Second body'}})])
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1)
 const current=await readComposeDraft(org,actor,followup,binding),winner=results.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<typeof current>;expect(current.revision).toBe(state.revision+1);expect(current.content).toEqual(winner.value.content)
 const winningInput=current.operationId===input.operationId?input:{...input,operationId:current.operationId!,content:current.content!}
 await expect(writeComposeDraft(org,actor,followup,winningInput)).resolves.toMatchObject({revision:current.revision,operationId:current.operationId});expect((await readComposeDraft(org,actor,followup,binding)).revision).toBe(current.revision)
 const cleared=await writeComposeDraft(org,actor,followup,{...input,operationId:randomUUID(),expectedRevision:current.revision,content:null});expect(cleared.content).toBeNull();expect(cleared.revision).toBe(current.revision+1)
 await expect(writeComposeDraft(org,actor,followup,{...input,operationId:randomUUID(),expectedRevision:0})).rejects.toMatchObject({statusCode:409})
 checks.push('cas-races')
})
it('keeps retained private data protected and leaves baseline application records unchanged for rollback',async()=>{
 const before=await readComposeDraft(org,actor,followup,binding),saved=await writeComposeDraft(org,actor,followup,{operationId:randomUUID(),expectedRevision:before.revision,sourceVersion:before.sourceVersion,binding,content})
 const leadBefore=await prisma.lead.findUniqueOrThrow({where:{id:lead}})
 await prisma.lead.update({where:{id:lead},data:{assignedUserId:other}});await expect(readComposeDraft(org,actor,followup,binding)).rejects.toMatchObject({statusCode:404});await prisma.lead.update({where:{id:lead},data:{assignedUserId:actor,updatedAt:leadBefore.updatedAt}})
 await prisma.lead.update({where:{id:lead},data:{email:'changed@example.invalid'}});await expect(readComposeDraft(org,actor,followup,binding)).rejects.toMatchObject({statusCode:409});const changed=await readComposeDraft(org,actor,followup,{...binding,recipientEmail:'changed@example.invalid'});expect(changed).toMatchObject({outdated:true,content:null,revision:saved.revision});await prisma.lead.update({where:{id:lead},data:{email:leadBefore.email,updatedAt:leadBefore.updatedAt}})
 expect((await readComposeDraft(org,actor,followup,binding)).content).toEqual(content)
 expect({leads:await prisma.lead.findMany({orderBy:{id:'asc'}}),followups:await prisma.followUpSuggestion.findMany({orderBy:{id:'asc'}})}).toEqual(baseline)
 expect(await prisma.task.count()).toBe(0);expect(await prisma.activity.count()).toBe(0)
 // Additive-schema rollback retains encrypted rows; old application queries remain identical.
 expect(await prisma.followUpComposeDraft.count()).toBe(1)
 expect((await prisma.followUpComposeDraft.findFirstOrThrow()).ciphertext).not.toContain(content.body)
 checks.push('rollback')
})
afterAll(async()=>{if(process.env.INBOX_PERF_REPORT)writeFileSync(process.env.INBOX_PERF_REPORT,JSON.stringify({checks}));await prisma.$disconnect()})
