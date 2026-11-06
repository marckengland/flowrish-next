import {randomUUID} from 'node:crypto'
import {beforeAll,afterAll,expect,it,vi} from 'vitest'
const clock=vi.hoisted(()=>({now:new Date()}))
vi.mock('@/server/db/client',async()=>{
 const raw=process.env.COUNTS_TEST_DATABASE_URL
 if(!raw)throw new Error('Explicit disposable database required.')
 const url=new URL(raw)
 if(url.protocol!=='postgresql:'||url.hostname!=='127.0.0.1'||url.username!=='postgres'||url.password!=='mock-only'||url.pathname!=='/postgres')throw new Error('Disposable loopback database only.')
 const {PrismaClient}=await import('@prisma/client')
 return {prisma:new PrismaClient({datasources:{db:{url:raw}},log:[]})}
})
vi.mock('@/server/services/follow-up-snooze',async()=>({...await vi.importActual<typeof import('@/server/services/follow-up-snooze')>('@/server/services/follow-up-snooze'),snoozeClock:async()=>new Date(clock.now)}))
import {prisma} from '@/server/db/client'
import {readFollowUpCounts} from '@/server/services/follow-up-counts'
import {listFollowUps} from '@/server/services/follow-ups'
import {followUpFilterSchema} from '@/lib/follow-up-filters'
import {filtersForFollowUpTab} from '@/lib/follow-up-task-progress'
const org=randomUUID(),foreign=randomUUID(),actor=randomUUID(),other=randomUUID(),lead=randomUUID(),hidden=randomUUID(),deleted=randomUUID(),merged=randomUUID(),pipeline=randomUUID(),stage=randomUUID(),team=randomUUID(),role=randomUUID()
const ids:Record<string,string>={},now=clock.now
const task=(key:string,extra:Record<string,unknown>={})=>({id:ids[key]=randomUUID(),organizationId:org,leadId:lead,assigneeId:actor,title:key,dueDate:new Date(now.getTime()-60000),...extra})
const item=(key:string,status='PENDING',extra:Record<string,unknown>={})=>({id:ids[key]=randomUUID(),organizationId:org,assigneeId:actor,leadId:lead,sourceKey:key,sourceType:'EMAIL',sourceId:key,sourceText:'Synthetic',title:key,description:'Synthetic',status,...extra})
beforeAll(async()=>{
 await prisma.organization.createMany({data:[org,foreign].map(id=>({id,name:'Synthetic counts',slug:id}))})
 await prisma.user.createMany({data:[actor,other].map(id=>({id,authId:randomUUID(),email:id+'@example.test',name:'Synthetic'}))})
 await prisma.organizationMember.createMany({data:[actor,other].map(userId=>({userId,organizationId:org}))})
 await prisma.team.create({data:{id:team,organizationId:org,name:'Synthetic'}})
 await prisma.role.create({data:{id:role,organizationId:org,name:'Synthetic member',hierarchy:3,permissions:{create:[{key:'leads:read'},{key:'leads:write'}]}}})
 await prisma.teamMember.create({data:{teamId:team,userId:actor,roleId:role}})
 await prisma.pipeline.create({data:{id:pipeline,organizationId:org,name:'Synthetic'}})
 await prisma.stage.create({data:{id:stage,pipelineId:pipeline,name:'New',order:1}})
 await prisma.lead.createMany({data:[lead,hidden,deleted,merged].map(id=>({id,organizationId:org,stageId:stage,firstName:'Literal %_',lastName:'Clinic',assignedUserId:id===hidden?other:actor,deletedAt:id===deleted?now:null,mergedIntoId:id===merged?lead:null}))})
 await prisma.task.createMany({data:[task('overdue'),task('future',{dueDate:new Date(now.getTime()+60000)}),task('completed',{isComplete:true,completedAt:now}),task('boundary',{dueDate:now}),task('other',{assigneeId:other}),task('wrongLead',{leadId:hidden})]})
 await prisma.followUpSuggestion.createMany({data:[...Array.from({length:121},(_,i)=>item('pending-'+i)),item('elapsed'),item('equal'),item('future'),item('dismissed','DISMISSED'),item('overdue-a','APPROVED',{taskId:ids.overdue}),item('overdue-b','APPROVED',{taskId:ids.overdue}),item('future-task','APPROVED',{taskId:ids.future}),item('complete-task','APPROVED',{taskId:ids.completed}),item('boundary-task','APPROVED',{taskId:ids.boundary}),item('private-task','APPROVED',{taskId:ids.other}),item('wrong-task','APPROVED',{taskId:ids.wrongLead}),item('call','PENDING',{taskId:ids.overdue,sourceType:'CALL'}),item('null-call','PENDING',{sourceType:'CALL'}),item('other-call','PENDING',{taskId:ids.other,sourceType:'CALL'}),item('complete-call','PENDING',{taskId:ids.completed,sourceType:'CALL'}),item('hidden','PENDING',{leadId:hidden}),item('deleted','PENDING',{leadId:deleted}),item('merged','PENDING',{leadId:merged}),item('other-user','PENDING',{assigneeId:other}),item('foreign','PENDING',{organizationId:foreign})]})
 await prisma.followUpSnooze.createMany({data:[{organizationId:org,userId:actor,followUpId:ids.elapsed,until:new Date(now.getTime()-1),timeZone:'UTC'},{organizationId:org,userId:actor,followUpId:ids.equal,until:now,timeZone:'UTC'},{organizationId:org,userId:actor,followUpId:ids.future,until:new Date(now.getTime()+86400000),timeZone:'UTC'},{organizationId:org,userId:other,followUpId:ids['pending-0'],until:new Date(now.getTime()+86400000),timeZone:'UTC'}]})
})
afterAll(async()=>{await prisma.$disconnect()})
const read=(filters:unknown={})=>readFollowUpCounts(org,actor,filters)
it('counts every authorized row beyond a page, partitions private reminders, and deduplicates overdue tasks at the exact UTC boundary',async()=>{
 const before=await prisma.followUpSuggestion.findMany({orderBy:{id:'asc'}}),tasks=await prisma.task.findMany({orderBy:{id:'asc'}})
 const result=await read()
 expect(result.data.counts).toEqual({PENDING:124,APPROVED:7,DISMISSED:1,SNOOZED:1})
 expect(result.data.overdueTasks).toBe(1)
 expect(result.data.checkedAt).toBe(now.toISOString())
 expect(await prisma.followUpSuggestion.findMany({orderBy:{id:'asc'}})).toEqual(before)
 expect(await prisma.task.findMany({orderBy:{id:'asc'}})).toEqual(tasks)
 expect(await prisma.auditEntry.count()).toBe(0);expect(await prisma.aiUsageDay.count()).toBe(0);expect(await prisma.activity.count()).toBe(0)
})
it('matches the real paged inbox and per-tab projections without a first-page ceiling',async()=>{
 for(const raw of [{},{source:'CALL'},{search:'%_'},{source:'EMAIL',search:'pending-'},{taskProgress:'OVERDUE'},{taskProgress:'COMPLETED'},{dueOnly:true}]){
  const filters=followUpFilterSchema.parse(raw),result=(await read(filters)).data
  for(const status of ['PENDING','APPROVED','DISMISSED','SNOOZED'] as const){
   const rows=new Set<string>(),seen=new Set<string>();let after:string|undefined
   do{const page=await listFollowUps(org,actor,status,[],filtersForFollowUpTab(filters,status),{...(after?{after}:{})},true,true);for(const row of page.items)rows.add(row.id);after=page.page?.nextCursor??undefined;if(after){expect(seen.has(after),status+JSON.stringify(raw)).toBe(false);seen.add(after)}}while(after)
   expect(rows.size).toBe(result.counts[status])
  }
 }
 expect((await read({source:'CALL'})).data.counts.PENDING).toBe(1)
 expect((await read({search:'%_'})).data.counts.PENDING).toBe(124)
 expect((await read({taskProgress:'OVERDUE'})).data).toMatchObject({counts:{APPROVED:2},overdueTasks:1})
 expect((await read({taskProgress:'COMPLETED'})).data).toMatchObject({counts:{APPROVED:1},overdueTasks:0})
 expect((await read({dueOnly:true})).data.counts.PENDING).toBe(2)
})
it('uses real manager team membership and task scope without exposing foreign workspaces',async()=>{
 await prisma.teamMember.create({data:{teamId:team,userId:other,roleId:role}})
 await prisma.role.update({where:{id:role},data:{hierarchy:2}})
 expect((await read()).data).toMatchObject({counts:{PENDING:125,APPROVED:7,DISMISSED:1,SNOOZED:1},overdueTasks:2})
 await prisma.role.update({where:{id:role},data:{hierarchy:3}})
 expect((await read()).data).toMatchObject({counts:{PENDING:124},overdueTasks:1})
})
it('rejects revoked read permission and membership without writes or private totals',async()=>{
 await prisma.rolePermission.deleteMany({where:{roleId:role,key:'leads:read'}})
 await expect(read()).rejects.toMatchObject({statusCode:403})
 await prisma.organizationMember.deleteMany({where:{organizationId:org,userId:actor}})
 await expect(read()).rejects.toMatchObject({statusCode:403})
 expect(await prisma.auditEntry.count()).toBe(0);expect(await prisma.aiUsageDay.count()).toBe(0)
})
