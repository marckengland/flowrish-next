import { afterEach, expect, it, vi } from 'vitest'
import { canBulkCompleteTask, uniqueCompletionSelection, makeBulkTaskCompletionPlan, previewBulkTaskCompletion, runBulkTaskCompletion, verifyBulkTaskCompletion } from './follow-up-bulk-task-completion'
const context={organizationId:'org',userId:'actor'},version='a'.repeat(64),at='2026-11-06T00:00:00.000Z'
const entry=(id:string,n=1)=>({id,listKey:id,input:{requestId:`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`,expectedVersion:version,taskId:'task-'+id}})
const plan=()=>makeBulkTaskCompletionPlan([entry('a'),entry('b',2)])
const response=(data:unknown,scope=context,canWrite=true)=>new Response(JSON.stringify({data,scope,capabilities:{canWrite}}))
const preview=(id:string)=>({id,version,leadName:'Practice',task:{id:'task-'+id,title:'Call '+id,description:'Notes',assigneeId:'manager-team-member',assigneeName:'Team member',dueDate:at}})
const receipt=(id:string,requestId=entry(id,id==='a'?1:2).input.requestId)=>({id,requestId,state:'confirmed',task:{id:'task-'+id,dueDate:at,completedAt:at,checkedAt:at}})
const hooks=()=>({active:()=>true,onChanged:vi.fn(),onAccessLost:vi.fn()})
afterEach(()=>vi.unstubAllGlobals())
it('bounds unique plans and deduplicates task selection while excluding unavailable/completed/non-Approved rows',()=>{
 for(const rows of [[],[entry('a'),entry('a')],[entry('a'),{...entry('b',2),input:{...entry('b',2).input,taskId:'task-a'}}],Array.from({length:21},(_,i)=>entry(String(i),i+1))])expect(()=>makeBulkTaskCompletionPlan(rows)).toThrow()
 const item={id:'a',taskId:'task-a',status:'APPROVED',taskProgress:{state:'OPEN' as const,dueDate:at,completedAt:null,checkedAt:at}}
 expect(canBulkCompleteTask(item)).toBe(true);expect(canBulkCompleteTask({...item,status:'PENDING'})).toBe(false);expect(canBulkCompleteTask({...item,taskProgress:{state:'UNAVAILABLE'}})).toBe(false);expect(canBulkCompleteTask({...item,taskProgress:{...item.taskProgress,state:'COMPLETED'}})).toBe(false)
 expect(uniqueCompletionSelection([item,{...item,id:'alias'},{...item,id:'b',taskId:'task-b'}])).toEqual(['a','b'])
})
it('previews with scoped GET only and allows the server-authorized manager assignee while checking exact task identity',async()=>{
 const fetcher=vi.fn().mockResolvedValue(response(preview('a')));vi.stubGlobal('fetch',fetcher);expect((await previewBulkTaskCompletion(['a'],context,hooks())).map(row=>row.id)).toEqual(['a']);expect(fetcher.mock.calls[0][1]).toMatchObject({method:'GET',headers:{'x-flowrish-workspace':'org','x-flowrish-follow-up-scope':JSON.stringify(['org','actor'])}})
 fetcher.mockResolvedValue(response(preview('wrong')));await expect(previewBulkTaskCompletion(['a'],context,hooks())).rejects.toThrow()
})
it('submits frozen reviewed inputs sequentially and checks exact receipt request and task',async()=>{
 let active=0,max=0;const fetcher=vi.fn().mockImplementation(async(url,init)=>{active++;max=Math.max(max,active);const id=String(url).includes('/a/')?'a':'b';expect(JSON.parse(init.body)).toEqual(entry(id,id==='a'?1:2).input);await Promise.resolve();active--;return response(receipt(id))});vi.stubGlobal('fetch',fetcher);const h=hooks(),rows=await runBulkTaskCompletion(plan(),context,h);expect(rows.map(row=>row.state)).toEqual(['completed','completed']);expect(h.onChanged.mock.calls.map(([row])=>row.id)).toEqual(['a','b']);expect(max).toBe(1);expect(fetcher.mock.calls.every(([,init])=>init.method==='POST')).toBe(true)
})
it('stops after lost confirmation and checks only that exact request without submitting remaining work',async()=>{
 const fetcher=vi.fn().mockRejectedValueOnce(new Error('lost'));vi.stubGlobal('fetch',fetcher);const h=hooks(),rows=await runBulkTaskCompletion(plan(),context,h);expect(rows.map(row=>row.state)).toEqual(['unconfirmed','not-attempted']);expect(fetcher).toHaveBeenCalledOnce();fetcher.mockResolvedValueOnce(response(receipt('a')))
 expect((await verifyBulkTaskCompletion(plan(),rows,context,h)).map(row=>row.state)).toEqual(['verified','not-attempted']);expect(fetcher.mock.calls[1][0]).toBe('/api/follow-ups/a/task-completion?requestId='+entry('a').input.requestId);expect(fetcher.mock.calls[1][1].method).toBe('GET');expect(fetcher).toHaveBeenCalledTimes(2)
})
it('keeps earlier successes and stops on conflicts, wrong receipts, stale scope, or permission changes',async()=>{
 for(const res of [response(receipt('wrong')),response({...receipt('b'),task:{...receipt('b').task,id:'wrong-task'}}),response(receipt('b'),{...context,userId:'other'}),response(receipt('b'),context,false),new Response(JSON.stringify({error:{code:'FOLLOW_UP_CHANGED',message:'Changed'}}),{status:409})]){
  const fetcher=vi.fn().mockResolvedValueOnce(response(receipt('a'))).mockResolvedValueOnce(res);vi.stubGlobal('fetch',fetcher);const rows=await runBulkTaskCompletion(makeBulkTaskCompletionPlan([entry('a'),entry('b',2),entry('c',3)]),context,hooks());expect(rows[0].state).toBe('completed');expect(rows[1].state).not.toBe('completed');expect(rows[2].state).toBe('not-attempted');expect(fetcher).toHaveBeenCalledTimes(2)
 }
})
it('rejects stale selections and aborts before any transport; drops a delayed response once inactive',async()=>{
 const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);await runBulkTaskCompletion(plan(),context,{...hooks(),isCurrent:()=>false});expect(fetcher).not.toHaveBeenCalled()
 await runBulkTaskCompletion(plan(),context,{...hooks(),active:()=>false});expect(fetcher).not.toHaveBeenCalled();const aborted=new AbortController();aborted.abort();expect((await runBulkTaskCompletion(plan(),context,{...hooks(),signal:aborted.signal})).map(row=>row.state)).toEqual(['not-attempted','not-attempted']);expect(fetcher).not.toHaveBeenCalled()
 let finish!:(value:Response)=>void,active=true;fetcher.mockReturnValue(new Promise<Response>(resolve=>{finish=resolve}));const h={...hooks(),active:()=>active},running=runBulkTaskCompletion(plan(),context,h);active=false;finish(response(receipt('a')));await running;expect(fetcher).toHaveBeenCalledOnce();expect(h.onChanged).not.toHaveBeenCalled()
})
it('does not reuse attempted receipts for different batches and reports not-recorded/changed without writes',async()=>{
 const p=plan(),fetcher=vi.fn().mockResolvedValue(response({id:'a',requestId:entry('a').input.requestId,state:'not-recorded',task:null}));vi.stubGlobal('fetch',fetcher)
 const previous=[{id:'a',state:'unconfirmed' as const,message:'Unknown'},{id:'b',state:'not-attempted' as const,message:'Not attempted'}];const result=await verifyBulkTaskCompletion(p,previous,context,hooks());expect(result.map(row=>row.state)).toEqual(['not-recorded','not-attempted']);expect(fetcher).toHaveBeenCalledOnce();expect(fetcher.mock.calls[0][1].method).toBe('GET');await expect(verifyBulkTaskCompletion(p,[...previous].reverse(),context,hooks())).rejects.toThrow()
})
it('records an in-flight abort as unconfirmed and never attempts the next task',async()=>{
 const abort=new AbortController(),fetcher=vi.fn().mockImplementation(async()=>{abort.abort();throw new DOMException('Aborted','AbortError')});vi.stubGlobal('fetch',fetcher)
 expect((await runBulkTaskCompletion(plan(),context,{...hooks(),signal:abort.signal})).map(row=>row.state)).toEqual(['unconfirmed','not-attempted']);expect(fetcher).toHaveBeenCalledOnce()
})
it('captures the account and reviewed payloads before the first queued request',async()=>{
 const original=plan(),scope={...context};const fetcher=vi.fn().mockImplementation(async(url,init)=>{const id=String(url).includes('/a/')?'a':'b';expect(new Headers(init.headers).get('x-flowrish-follow-up-scope')).toBe(JSON.stringify(['org','actor']));expect(JSON.parse(init.body)).toEqual(entry(id,id==='a'?1:2).input);if(id==='a'){original[1].input.taskId='changed-after-start';scope.userId='other'}return response(receipt(id))});vi.stubGlobal('fetch',fetcher)
 expect((await runBulkTaskCompletion(original,scope,hooks())).map(row=>row.state)).toEqual(['completed','completed']);expect(fetcher).toHaveBeenCalledTimes(2)
})
