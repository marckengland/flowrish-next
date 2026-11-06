import { afterEach, expect, it, vi } from 'vitest'
import { makeBulkTaskReschedulePlan, previewBulkTaskReschedule, runBulkTaskReschedule, verifyBulkTaskReschedule } from './follow-up-bulk-task-reschedule'
const context={organizationId:'org',userId:'actor'},version='a'.repeat(64),old='2020-01-01T00:00:00.000Z',due='2099-11-07T01:00:00.000Z',target={localTime:'2099-11-07T09:00',timeZone:'Asia/Manila'}
const entry=(id:string,n=1)=>({id,listKey:id,previousDueDate:old,dueDate:due,input:{requestId:`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`,expectedVersion:version,taskId:'task-'+id,...target}})
const plan=()=>makeBulkTaskReschedulePlan([entry('a'),entry('b',2)])
const response=(data:unknown,scope=context,canWrite=true)=>new Response(JSON.stringify({data,scope,capabilities:{canWrite}}))
const preview=(id:string)=>({id,version,leadName:'Practice',...target,newDueDate:due,task:{id:'task-'+id,title:'Call '+id,description:'Notes',assigneeId:'team-member',assigneeName:'Practice Owner',dueDate:old}})
const receipt=(id:string)=>({id,requestId:entry(id,id==='a'?1:2).input.requestId,state:'confirmed',task:{id:'task-'+id,previousDueDate:old,dueDate:due,checkedAt:'2026-11-06T00:00:00.000Z'}})
const hooks=()=>({active:()=>true,onChanged:vi.fn(),onAccessLost:vi.fn()})
afterEach(()=>vi.unstubAllGlobals())
it('bounds unique task/request selections and rejects no-op or inconsistent target dates',()=>{
 for(const rows of [[],[entry('a'),entry('a')],[entry('a'),{...entry('b',2),input:{...entry('b',2).input,taskId:'task-a'}}],Array.from({length:21},(_,i)=>entry(String(i),i+1)),[{...entry('a'),dueDate:old}],[{...entry('a'),previousDueDate:due}],[{...entry('a'),input:{...entry('a').input,timeZone:'UTC'}}]])expect(()=>makeBulkTaskReschedulePlan(rows)).toThrow()
 expect(plan()).toHaveLength(2)
})
it('rejects invalid, past, nonexistent and ambiguous local times before any read or write',async()=>{
 const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher)
 for(const t of [{localTime:'bad',timeZone:'UTC'},{localTime:'2099-02-30T09:00',timeZone:'UTC'},{...target,timeZone:'Invalid/Zone'},{localTime:'2020-01-01T09:00',timeZone:'UTC'},{localTime:'2027-03-14T02:30',timeZone:'America/New_York'},{localTime:'2027-11-07T01:30',timeZone:'America/New_York'}])await expect(previewBulkTaskReschedule(['a'],t,context,hooks())).rejects.toThrow()
 expect(fetcher).not.toHaveBeenCalled()
})
it('previews scoped GET-only old/new dates and requires exact target metadata including conversion',async()=>{
 const fetcher=vi.fn().mockResolvedValue(response(preview('a')));vi.stubGlobal('fetch',fetcher);const rows=await previewBulkTaskReschedule(['a'],target,context,hooks());expect(rows[0].newDueDate).toBe(due);const [path,init]=fetcher.mock.calls[0],q=new URL(path,'https://example.invalid').searchParams;expect(Object.fromEntries(q)).toEqual(target);expect(init).toMatchObject({method:'GET',headers:{'x-flowrish-workspace':'org','x-flowrish-follow-up-scope':JSON.stringify(['org','actor'])}})
 for(const data of [{...preview('a'),id:'wrong'},{...preview('a'),timeZone:'UTC'},{...preview('a'),localTime:'2099-11-07T10:00'},{...preview('a'),newDueDate:'2099-11-07T02:00:00.000Z'}]){fetcher.mockResolvedValue(response(data));await expect(previewBulkTaskReschedule(['a'],target,context,hooks())).rejects.toThrow()}
})
it('submits immutable reviewed targets sequentially and validates exact old/new receipt dates',async()=>{
 const raw=plan(),scope={...context};let active=0,max=0;const fetcher=vi.fn().mockImplementation(async(url,init)=>{active++;max=Math.max(max,active);const id=String(url).includes('/a/')?'a':'b';expect(JSON.parse(init.body)).toEqual(entry(id,id==='a'?1:2).input);expect(new Headers(init.headers).get('x-flowrish-follow-up-scope')).toBe(JSON.stringify(['org','actor']));if(id==='a'){raw[1].input.localTime='2099-11-08T09:00';scope.userId='other'}await Promise.resolve();active--;return response(receipt(id))});vi.stubGlobal('fetch',fetcher);const h=hooks();expect((await runBulkTaskReschedule(raw,scope,h)).map(row=>row.state)).toEqual(['rescheduled','rescheduled']);expect(max).toBe(1);expect(h.onChanged).toHaveBeenCalledTimes(2)
})
it('stops on lost confirmation and checks the exact request with GET without touching the remainder',async()=>{
 const fetcher=vi.fn().mockRejectedValueOnce(new Error('Lost response'));vi.stubGlobal('fetch',fetcher);const rows=await runBulkTaskReschedule(plan(),context,hooks());expect(rows.map(row=>row.state)).toEqual(['unconfirmed','not-attempted']);fetcher.mockResolvedValueOnce(response(receipt('a')));expect((await verifyBulkTaskReschedule(plan(),rows,context,hooks())).map(row=>row.state)).toEqual(['verified','not-attempted']);expect(fetcher.mock.calls[1][0]).toBe('/api/follow-ups/a/task-reschedule?requestId='+entry('a').input.requestId);expect(fetcher.mock.calls[1][1].method).toBe('GET');expect(fetcher).toHaveBeenCalledTimes(2)
})
it('keeps earlier successes and stops on wrong receipts, permission loss, scope changes and server conflicts',async()=>{
 for(const res of [response({...receipt('b'),requestId:entry('a').input.requestId}),response({...receipt('b'),task:{...receipt('b').task,previousDueDate:due}}),response({...receipt('b'),task:{...receipt('b').task,dueDate:old}}),response({...receipt('b'),task:{...receipt('b').task,id:'wrong'}}),response(receipt('b'),{...context,userId:'other'}),response(receipt('b'),context,false),new Response(JSON.stringify({error:{code:'FOLLOW_UP_CHANGED',message:'Changed'}}),{status:409})]){const fetcher=vi.fn().mockResolvedValueOnce(response(receipt('a'))).mockResolvedValueOnce(res);vi.stubGlobal('fetch',fetcher);const result=await runBulkTaskReschedule(makeBulkTaskReschedulePlan([entry('a'),entry('b',2),entry('c',3)]),context,hooks());expect(result[0].state).toBe('rescheduled');expect(result[1].state).not.toBe('rescheduled');expect(result[2].state).toBe('not-attempted');expect(fetcher).toHaveBeenCalledTimes(2)}
})
it('blocks stale selections and pre-aborted queues and marks an in-flight abort unconfirmed',async()=>{
 const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const pre=new AbortController();pre.abort();expect((await runBulkTaskReschedule(plan(),context,{...hooks(),signal:pre.signal})).map(row=>row.state)).toEqual(['not-attempted','not-attempted']);await runBulkTaskReschedule(plan(),context,{...hooks(),isCurrent:()=>false});expect(fetcher).not.toHaveBeenCalled()
 const abort=new AbortController();fetcher.mockImplementation(async()=>{abort.abort();throw new DOMException('Aborted','AbortError')});expect((await runBulkTaskReschedule(plan(),context,{...hooks(),signal:abort.signal})).map(row=>row.state)).toEqual(['unconfirmed','not-attempted']);expect(fetcher).toHaveBeenCalledOnce()
})
it('does not submit an expired review but still verifies its exact committed request after the deadline passes',async()=>{
 const past={...entry('a'),previousDueDate:'2019-01-01T00:00:00.000Z',dueDate:old,input:{...entry('a').input,localTime:'2020-01-01T00:00',timeZone:'UTC'}},p=makeBulkTaskReschedulePlan([past]),fetcher=vi.fn().mockResolvedValue(response({...receipt('a'),task:{...receipt('a').task,previousDueDate:past.previousDueDate,dueDate:past.dueDate}}));vi.stubGlobal('fetch',fetcher)
 expect((await runBulkTaskReschedule(p,context,hooks()))[0].state).toBe('not-attempted');expect(fetcher).not.toHaveBeenCalled();expect((await verifyBulkTaskReschedule(p,[{id:'a',state:'unconfirmed',message:'Unknown'}],context,hooks()))[0].state).toBe('verified');expect(fetcher).toHaveBeenCalledOnce();expect(fetcher.mock.calls[0][1].method).toBe('GET')
})
it('drops delayed inactive responses and refuses checking a different batch or writing during verification',async()=>{
 let finish!:(r:Response)=>void,active=true;const fetcher=vi.fn().mockReturnValue(new Promise<Response>(r=>{finish=r})),h={...hooks(),active:()=>active};vi.stubGlobal('fetch',fetcher);const pending=runBulkTaskReschedule(plan(),context,h);active=false;finish(response(receipt('a')));await pending;expect(h.onChanged).not.toHaveBeenCalled();expect(fetcher).toHaveBeenCalledOnce()
 await expect(verifyBulkTaskReschedule(plan(),[{id:'b',state:'failed',message:'Failed'},{id:'a',state:'not-attempted',message:'Not attempted'}],context,hooks())).rejects.toThrow()
})
