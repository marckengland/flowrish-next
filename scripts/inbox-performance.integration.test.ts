import {randomUUID} from 'node:crypto'
import {performance} from 'node:perf_hooks'
import {writeFileSync} from 'node:fs'
import {afterAll,expect,it,vi} from 'vitest'
const trace=vi.hoisted(()=>({race:null as null|{taskId:string;owner:string},active:false,models:[] as {model:string;operation:string;rows:number}[],sql:[] as {query:string;params:string;duration:number}[]}))
vi.mock('@/server/db/client',async()=>{
 const raw=process.env.INBOX_PERF_DATABASE_URL
 if(!raw)throw new Error('Explicit disposable database required.')
 const url=new URL(raw)
 if(url.protocol!=='postgresql:'||url.hostname!=='127.0.0.1'||url.username!=='postgres'||url.password!=='mock-only'||url.pathname!=='/postgres')throw new Error('Disposable loopback database only.')
 const {PrismaClient}=await import('@prisma/client')
 const client=new PrismaClient({datasources:{db:{url:raw}},log:[{emit:'event',level:'query'}]})
 client.$on('query',event=>{if(trace.active)trace.sql.push({query:event.query,params:event.params,duration:event.duration})})
 return {prisma:client.$extends({query:{$allModels:{async $allOperations({model,operation,args,query}){const result=await query(args);if(model==='ReceptionistCall'&&operation==='findMany'&&Array.isArray(result)&&result.length&&trace.race){const race=trace.race;trace.race=null;await client.task.update({where:{id:race.taskId},data:{assigneeId:race.owner}})}if(trace.active)trace.models.push({model,operation,rows:Array.isArray(result)?result.length:result?1:0});return result}}}})}
})
import {prisma} from '@/server/db/client'
import {readFollowUpCounts} from '@/server/services/follow-up-counts'
import {listFollowUpHistory} from '@/server/services/follow-up-history'
import {listFollowUps,reviewFollowUp} from '@/server/services/follow-ups'
const report:{size:number;scenario:string;medianMs:number;p95Ms:number;sqlMs:number;queries:number;taskRows:number;returned:number;plan?:unknown}[]=[]
const stamp=new Date(),sampleBody='Synthetic business conversation. '.repeat(60)
async function seed(size:number){
 const org=randomUUID(),actor=randomUUID(),other=randomUUID(),team=randomUUID(),role=randomUUID(),pipeline=randomUUID(),stage=randomUUID()
 await prisma.organization.create({data:{id:org,name:'Synthetic inbox performance',slug:org}})
 await prisma.user.createMany({data:[actor,other].map(id=>({id,authId:randomUUID(),email:id+'@example.invalid',name:'Synthetic actor'}))})
 await prisma.organizationMember.createMany({data:[actor,other].map(userId=>({organizationId:org,userId}))})
 await prisma.team.create({data:{id:team,organizationId:org,name:'Synthetic team'}})
 await prisma.role.create({data:{id:role,organizationId:org,name:'Synthetic member',hierarchy:3,permissions:{create:[{key:'leads:read'},{key:'leads:write'}]}}})
 await prisma.teamMember.create({data:{userId:actor,teamId:team,roleId:role}})
 await prisma.pipeline.create({data:{id:pipeline,organizationId:org,name:'Synthetic pipeline'}})
 await prisma.stage.create({data:{id:stage,pipelineId:pipeline,name:'New',order:1}})
 const ids:string[]=[],expected={PENDING:0,APPROVED:0,DISMISSED:0,SNOOZED:0},approvedTasks:string[]=[]
 for(let start=0;start<size;start+=500){
  const indices=Array.from({length:Math.min(500,size-start)},(_,j)=>start+j),leads=indices.map(i=>({id:randomUUID(),organizationId:org,stageId:stage,firstName:'Synthetic',lastName:'Contact '+i,email:`person-${i}@example.invalid`,assignedUserId:actor})),tasks=indices.map((i,j)=>({id:randomUUID(),organizationId:org,leadId:leads[j].id,assigneeId:actor,title:'Synthetic task '+i,dueDate:new Date(stamp.getTime()+(i%10===6?86400000:-86400000)-i*1000),isComplete:i%10===7,completedAt:i%10===7?stamp:null}))
  const rows=indices.map((i,j)=>{const status=i%10>=5&&i%10<=7?'APPROVED':i%10===8?'DISMISSED':'PENDING',future=i%10===9&&i%30!==9;expected[future?'SNOOZED':status]++;const id=randomUUID();ids.push(id);if(status==='APPROVED')approvedTasks.push(tasks[j].id);return {id,organizationId:org,assigneeId:actor,leadId:leads[j].id,sourceKey:JSON.stringify(['synthetic',i]),sourceId:String(i),sourceType:i%10===4||i%10===5?'CALL':'EMAIL',sourceText:sampleBody,title:(i%1000===0?'needle %_ ':'')+'Follow-up '+i,description:'Synthetic notes',draftSubject:'Synthetic subject',draftBody:sampleBody,taskId:i%10>=4&&i%10<=7?tasks[j].id:null,status,createdAt:new Date(stamp.getTime()-i*1000)}})
  await prisma.lead.createMany({data:leads});await prisma.task.createMany({data:tasks});await prisma.followUpSuggestion.createMany({data:rows})
  const snoozes=indices.flatMap((i,j)=>i%10===9?[{organizationId:org,userId:actor,followUpId:rows[j].id,until:new Date(stamp.getTime()+(i%30===9?-86400000:86400000)),timeZone:'Asia/Manila'}]:[])
  if(snoozes.length)await prisma.followUpSnooze.createMany({data:snoozes})
 }
 // An inaccessible mailbox/lead population must not affect returned totals.
 const hiddenLead=randomUUID();await prisma.lead.create({data:{id:hiddenLead,organizationId:org,stageId:stage,firstName:'Hidden',lastName:'Synthetic',assignedUserId:other}})
 await prisma.followUpSuggestion.createMany({data:Array.from({length:Math.ceil(size/5)},(_,i)=>({organizationId:org,assigneeId:i%2?actor:other,leadId:hiddenLead,sourceKey:'hidden-'+i,sourceType:'EMAIL',sourceId:'hidden-'+i,sourceText:sampleBody,title:'Hidden follow-up',description:'Synthetic notes'}))})
 await prisma.$executeRawUnsafe('ANALYZE "Lead", "Task", "FollowUpSuggestion", "FollowUpSnooze", "OrganizationMember", "TeamMember", "RolePermission"')
 return {org,actor,other,ids,expected,approvedTasks}
}
type Data=Awaited<ReturnType<typeof seed>>
async function measure(data:Data,size:number,scenario:string,action:()=>Promise<{items?:unknown[];data?:unknown}>){
 await action() // Warm the client, statement plans and shared buffers.
 const times:number[]=[],sqlTimes:number[]=[],counts:number[]=[],taskRows:number[]=[];let returned=0,sql:typeof trace.sql=[]
 for(let i=0;i<5;i++){
  trace.models=[];trace.sql=[];trace.active=true;const start=performance.now()
  try{const result=await action();returned=result.items?.length??1}finally{times.push(performance.now()-start);trace.active=false}
  sql=trace.sql;sqlTimes.push(sql.reduce((n,q)=>n+q.duration,0));counts.push(sql.length);taskRows.push(trace.models.filter(q=>q.model==='Task'&&q.operation==='findMany').reduce((n,q)=>n+q.rows,0))
 }
 times.sort((a,b)=>a-b)
 let plan:unknown;const query=sql.find(q=>q.query.includes('WITH eligible')&&q.query.includes('page_candidates'))
 if(query){const params=(JSON.parse(query.params) as unknown[]).map(v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT/.test(v)?new Date(v):v);plan=await prisma.$queryRawUnsafe('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+query.query,...params)}
 report.push({size,scenario,medianMs:Number(times[2].toFixed(2)),p95Ms:Number(times[4].toFixed(2)),sqlMs:Math.max(...sqlTimes),queries:Math.max(...counts),taskRows:Math.max(...taskRows),returned,...(plan?{plan}:{})})
 console.log(JSON.stringify({...report.at(-1),plan:plan?'captured':undefined}))
}
for(const size of [1000,10000])it('measures scoped counts, search, overdue, paging and deadline order at '+size+' rows',async()=>{
 const data=await seed(size),list=(status:string,filters:unknown={},after?:string,retained:readonly string[]=[])=>listFollowUps(data.org,data.actor,status,retained,filters,{...(after?{after}:{})},true,true)
 const counts=await readFollowUpCounts(data.org,data.actor);expect(counts.data.counts).toEqual(data.expected);expect(counts.data.overdueTasks).toBe(size/10)
 const snapshot=async()=>{const rows=await prisma.$queryRawUnsafe<Array<{digest:string}>>(`SELECT md5(string_agg(md5(row_to_json(x)::text),'' ORDER BY x.id)) AS digest FROM "FollowUpSuggestion" x WHERE "organizationId"=$1`,data.org);return rows[0].digest}
 const before=await snapshot()
 await measure(data,size,'counts',()=>readFollowUpCounts(data.org,data.actor))
 await measure(data,size,'counts literal search',()=>readFollowUpCounts(data.org,data.actor,{search:'needle %_'}))
 await measure(data,size,'Pending page 1',()=>list('PENDING'))
 await measure(data,size,'Pending literal search',()=>list('PENDING',{search:'needle %_'}))
 await measure(data,size,'Approved overdue shortcut',()=>list('APPROVED',{taskProgress:'OVERDUE'}))
 const first=await list('PENDING');expect(first.items).toHaveLength(100);expect(first.page?.nextCursor).toBeTruthy();const retain=first.items[0].id
 await measure(data,size,'Pending Load more with retained draft',()=>list('PENDING',{},first.page!.nextCursor!,[retain]))
 const next=await list('PENDING',{},first.page!.nextCursor!,[retain]);expect(next.items).toHaveLength(101);expect(next.items.filter(row=>row.id!==retain).some(row=>first.items.some(old=>old.id===row.id))).toBe(false);expect(next.items.find(row=>row.id===retain)?.draftBody).toBe(sampleBody)
 const filtered=await list('PENDING',{search:'needle %_'},undefined,[retain]);expect(filtered.items.some(row=>row.id===retain)).toBe(true)
 await measure(data,size,'Approved deadline order',()=>list('APPROVED',{taskOrder:'DUE_ASC'}))
 const ordered=await list('APPROVED',{taskOrder:'DUE_ASC'}),orderedNext=await list('APPROVED',{taskOrder:'DUE_ASC'},ordered.page!.nextCursor!);expect(orderedNext.items).toHaveLength(100);expect(orderedNext.items.some(row=>ordered.items.some(old=>old.id===row.id))).toBe(false)
 for(const sample of report.filter(r=>r.size===size)){expect(sample.taskRows,sample.scenario+' bounded page task hydration').toBeLessThanOrEqual(200)}
 expect(await snapshot()).toBe(before);expect(await prisma.activity.count()).toBe(0);expect(await prisma.auditEntry.count()).toBe(0);expect(await prisma.aiUsageDay.count()).toBe(0)
},120000)
it('keeps bounded callback catch-up, reassignment, source deduplication and reviewed content intact',async()=>{
 const data=await seed(1000),tasks=await prisma.task.findMany({where:{organizationId:data.org,isComplete:false},orderBy:{id:'asc'},take:150}),callIds=Array.from({length:150},()=>randomUUID())
 await prisma.receptionistCall.createMany({data:callIds.map((id,i)=>({id,organizationId:data.org,callSid:id,state:{synthetic:true},status:'completed',leadId:tasks[i].leadId,taskId:tasks[i].id}))})
 const reassigned=Array.from({length:125},(_,i)=>({id:randomUUID(),organizationId:data.org,assigneeId:data.other,leadId:tasks[i].leadId!,taskId:tasks[i].id,sourceKey:'reassignment-'+i,sourceId:'synthetic-'+i,sourceType:'CALL',sourceText:sampleBody,title:'Synthetic reassignment',description:'Synthetic notes'}))
 const reviewed={...reassigned[0],id:randomUUID(),sourceKey:'reviewed-control',status:'APPROVED',draftBody:'Retain reviewed text'}
 await prisma.followUpSuggestion.createMany({data:[...reassigned,reviewed]})
 const hidden=await prisma.lead.findFirstOrThrow({where:{organizationId:data.org,assignedUserId:data.other}}),excludedTask=await prisma.task.create({data:{organizationId:data.org,leadId:hidden.id,assigneeId:data.actor,title:'Hidden synthetic task',dueDate:stamp}})
 const excluded=await prisma.followUpSuggestion.create({data:{...reassigned[0],id:randomUUID(),sourceKey:'hidden-control',leadId:hidden.id,taskId:excludedTask.id}})
 const first=await listFollowUps(data.org,data.actor,'PENDING',[],{},{},true,true)
 expect(first.page?.callbackCatchUp).toEqual({created:100,hasMore:true})
 expect(await prisma.followUpSuggestion.count({where:{id:{in:reassigned.map(row=>row.id)},assigneeId:data.actor}})).toBe(100)
 const second=await listFollowUps(data.org,data.actor,'PENDING',[],{},{},true,true)
 expect(second.page?.callbackCatchUp).toEqual({created:50,hasMore:false})
 expect(await prisma.followUpSuggestion.count({where:{id:{in:reassigned.map(row=>row.id)},assigneeId:data.actor}})).toBe(125)
 expect((await listFollowUps(data.org,data.actor,'PENDING',[],{},{},true,true)).page?.callbackCatchUp).toEqual({created:0,hasMore:false})
 const keys=callIds.map(id=>JSON.stringify(['call',id]));expect(await prisma.followUpSuggestion.count({where:{organizationId:data.org,sourceKey:{in:keys}}})).toBe(150)
 expect(await prisma.followUpSuggestion.findUnique({where:{id:reviewed.id}})).toMatchObject({assigneeId:data.other,status:'APPROVED',draftBody:'Retain reviewed text'})
 expect(await prisma.followUpSuggestion.findUnique({where:{id:excluded.id}})).toMatchObject({assigneeId:data.other,leadId:hidden.id})
 // Change task ownership after candidate hydration, before the service's canonical locks.
 const racedId=randomUUID();await prisma.receptionistCall.create({data:{id:racedId,organizationId:data.org,callSid:racedId,state:{synthetic:true},status:'completed',leadId:tasks[149].leadId,taskId:tasks[149].id}})
 trace.race={taskId:tasks[149].id,owner:data.other}
 expect((await listFollowUps(data.org,data.actor,'PENDING',[],{},{},true,true)).page?.callbackCatchUp?.created).toBe(0)
 expect(trace.race).toBeNull();expect(await prisma.followUpSuggestion.count({where:{organizationId:data.org,sourceKey:JSON.stringify(['call',racedId])}})).toBe(0)
 expect(await prisma.aiUsageDay.count()).toBe(0);expect(await prisma.activity.count()).toBe(0)
},120000)
afterAll(async()=>{if(process.env.INBOX_PERF_REPORT)writeFileSync(process.env.INBOX_PERF_REPORT,JSON.stringify({node:process.version,samples:5,warm:true,report},null,2));await prisma.$disconnect()})

it('restores dismissed reviews atomically with exact replay, task/draft retention and rollback',async()=>{
 const {previewFollowUpRestore,restoreFollowUp,readFollowUpRestore}=await import('@/server/services/follow-up-restore')
 const data=await seed(1000),dismissed=await prisma.followUpSuggestion.findMany({where:{organizationId:data.org,status:'DISMISSED'},take:3})
 const email=dismissed[0],callback=dismissed[1],rollback=dismissed[2],linked=await prisma.task.create({data:{organizationId:data.org,leadId:callback.leadId,assigneeId:data.actor,title:'Keep this existing callback task',description:'Keep original task details',dueDate:stamp}})
 await prisma.followUpSuggestion.update({where:{id:callback.id},data:{sourceType:'CALL',taskId:linked.id}})
 await prisma.followUpSnooze.create({data:{organizationId:data.org,userId:data.actor,followUpId:email.id,until:new Date(Date.now()+86400000),timeZone:'Asia/Manila'}})
 const before=await prisma.followUpSuggestion.findUniqueOrThrow({where:{id:email.id}}),taskCount=await prisma.task.count({where:{organizationId:data.org}}),sendCount=await prisma.followUpSendAttempt.count(),activityCount=await prisma.activity.count()
 const review=await previewFollowUpRestore(data.org,data.actor,email.id),input={requestId:randomUUID(),expectedVersion:review.version}
 expect(review.clearsSnooze).toBe(true)
 const results=await Promise.all([restoreFollowUp(data.org,data.actor,email.id,input),restoreFollowUp(data.org,data.actor,email.id,input)])
 expect(results.every(result=>result.state==='confirmed')).toBe(true);expect(await prisma.auditEntry.count({where:{id:input.requestId}})).toBe(1)
 expect(await prisma.followUpSuggestion.findUniqueOrThrow({where:{id:email.id}})).toEqual({...before,status:'PENDING',updatedAt:expect.any(Date)})
 expect(await prisma.followUpSnooze.findUniqueOrThrow({where:{organizationId_userId_followUpId:{organizationId:data.org,userId:data.actor,followUpId:email.id}}})).toMatchObject({until:null,revision:2,timeZone:'Asia/Manila'})
 expect((await readFollowUpRestore(data.org,data.actor,email.id,input.requestId)).state).toBe('confirmed')
 const audit=await prisma.auditEntry.findUniqueOrThrow({where:{id:input.requestId}}),history=await listFollowUpHistory(data.org,data.actor,email.id,{})
 expect(history.data.entries).toEqual([{id:input.requestId,kind:'restored',actor:'You',occurredAt:audit.createdAt.toISOString(),until:null,timeZone:null}])
 expect(JSON.stringify(history)).not.toMatch(/inputHash|version|taskId|restoredAt|sourceText|draftBody/)

 const callbackInput={requestId:randomUUID(),expectedVersion:(await previewFollowUpRestore(data.org,data.actor,callback.id)).version}
 await restoreFollowUp(data.org,data.actor,callback.id,callbackInput)
 expect(await prisma.task.findUniqueOrThrow({where:{id:linked.id}})).toEqual(linked)
 expect((await listFollowUps(data.org,data.actor,'PENDING',[email.id,callback.id],{},{},true)).items.filter(row=>[email.id,callback.id].includes(row.id))).toHaveLength(2)
 expect(await prisma.task.count({where:{organizationId:data.org}})).toBe(taskCount);expect(await prisma.followUpSendAttempt.count()).toBe(sendCount);expect(await prisma.activity.count()).toBe(activityCount)
 const approved=await reviewFollowUp(data.org,data.actor,email.id,{action:'approve',title:'Create one reviewed task'})
 expect(approved.taskId).toBeTruthy();expect((await reviewFollowUp(data.org,data.actor,email.id,{action:'approve',title:'Create one reviewed task'})).taskId).toBe(approved.taskId)
 expect(await prisma.task.count({where:{organizationId:data.org}})).toBe(taskCount+1)
 const laterHistory=await listFollowUpHistory(data.org,data.actor,email.id,{})
 expect(laterHistory.data.current.state).toBe('approved');expect(laterHistory.data.entries.filter(entry=>entry.kind==='restored')).toEqual(history.data.entries)

 await expect(restoreFollowUp(data.org,data.actor,email.id,{...input,requestId:randomUUID()})).rejects.toMatchObject({statusCode:409})
 await expect(readFollowUpRestore(data.org,data.other,email.id,input.requestId)).rejects.toBeDefined()
 await prisma.followUpSuggestion.update({where:{id:callback.id},data:{status:'DISMISSED'}});await prisma.task.update({where:{id:linked.id},data:{assigneeId:data.other}})
 await expect(previewFollowUpRestore(data.org,data.actor,callback.id)).rejects.toMatchObject({statusCode:404})
 const rollbackBefore=await prisma.followUpSuggestion.findUniqueOrThrow({where:{id:rollback.id}}),rollbackInput={requestId:randomUUID(),expectedVersion:(await previewFollowUpRestore(data.org,data.actor,rollback.id)).version}
 await prisma.$executeRawUnsafe(`CREATE FUNCTION synthetic_restore_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.changes ? 'restore' THEN RAISE EXCEPTION 'Synthetic audit rejection'; END IF; RETURN NEW; END $$`)
 await prisma.$executeRawUnsafe('CREATE TRIGGER synthetic_restore_audit_failure BEFORE INSERT ON "AuditEntry" FOR EACH ROW EXECUTE FUNCTION synthetic_restore_audit_failure()')
 try{await expect(restoreFollowUp(data.org,data.actor,rollback.id,rollbackInput)).rejects.toMatchObject({code:'FOLLOW_UP_UNAVAILABLE'});expect(await prisma.followUpSuggestion.findUniqueOrThrow({where:{id:rollback.id}})).toEqual(rollbackBefore);expect(await prisma.auditEntry.count({where:{id:rollbackInput.requestId}})).toBe(0)}
 finally{await prisma.$executeRawUnsafe('DROP TRIGGER synthetic_restore_audit_failure ON "AuditEntry"');await prisma.$executeRawUnsafe('DROP FUNCTION synthetic_restore_audit_failure()')}
 expect(await prisma.aiUsageDay.count()).toBe(0)
 console.log('Restore database checks passed: exact concurrent replay, unchanged tasks/drafts/send records, snooze reset, ownership and atomic rollback.')
},120000)
