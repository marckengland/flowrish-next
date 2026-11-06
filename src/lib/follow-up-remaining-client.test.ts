import {afterEach,expect,it,vi} from 'vitest'
import {fetchRemainingTaskReview} from './follow-up-remaining-client'
const context={organizationId:'org',userId:'actor'},id='22222222-2222-4222-8222-222222222222',at='2026-11-06T00:00:00.000Z'
const detail={id,kind:'COMPLETE' as const,canReview:true,createdAt:at,checkedAt:at,items:[{index:0,state:'failed' as const,currentChanged:false,task:{id:'task',title:'Current',leadId:'lead',leadName:'Practice',dueDate:at,isComplete:false}}]}
const preview={id:'source',version:'a'.repeat(64),leadName:'Practice',task:{id:'task',title:'Current',description:'Current notes',assigneeId:'actor',assigneeName:'Owner',dueDate:at}}
const result={batchId:id,kind:'COMPLETE',checkedAt:at,items:[{index:0,preview}],skipped:[]}
const reply=(data:unknown,wrong=false,write=true)=>new Response(JSON.stringify({data,scope:wrong?{...context,userId:'other'}:context,capabilities:{canWrite:write}}))
afterEach(()=>vi.restoreAllMocks())
it('reads exact selected ordinals with scoped no-store GET and current previews',async()=>{const f=vi.spyOn(globalThis,'fetch').mockResolvedValue(reply(result));expect(await fetchRemainingTaskReview(detail,{indices:[0]},context,{active:()=>true})).toEqual(result);expect(f).toHaveBeenCalledWith('/api/follow-ups/batches/'+id+'/review?index=0',expect.objectContaining({method:'GET',cache:'no-store',headers:expect.objectContaining({'x-flowrish-workspace':'org'})}))})
it('rejects wrong batch/task/indices, missing rows, duplicate previews, stale scope and lost writing permission',async()=>{
 const f=vi.spyOn(globalThis,'fetch');for(const data of [{...result,batchId:'11111111-1111-4111-8111-111111111111'},{...result,items:[{index:0,preview:{...preview,task:{...preview.task,id:'wrong'}}}]},{...result,items:[{index:1,preview}]},{...result,items:[]},{...result,items:[...result.items,...result.items]}]){f.mockResolvedValueOnce(reply(data));await expect(fetchRemainingTaskReview(detail,{indices:[0]},context,{active:()=>true})).rejects.toBeDefined()}
 for(const response of [reply(result,true),reply(result,false,false)]){f.mockResolvedValueOnce(response);await expect(fetchRemainingTaskReview(detail,{indices:[0]},context,{active:()=>true})).rejects.toBeDefined()}
 expect(f.mock.calls.every(([,init])=>init?.method==='GET')).toBe(true)
})
it('does not request inactive reviews or accept delayed inactive results',async()=>{let active=true,resolve!:(res:Response)=>void;const f=vi.spyOn(globalThis,'fetch').mockImplementation(()=>new Promise<Response>(r=>{resolve=r}));const pending=fetchRemainingTaskReview(detail,{indices:[0]},context,{active:()=>active});active=false;resolve(reply(result));await expect(pending).rejects.toBeDefined();await expect(fetchRemainingTaskReview(detail,{indices:[0]},context,{active:()=>false})).rejects.toBeDefined();expect(f).toHaveBeenCalledTimes(1)})
