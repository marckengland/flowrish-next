import { beforeEach, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
const m=vi.hoisted(()=>({read:vi.fn(),complete:vi.fn(),reschedule:vi.fn(),tx:vi.fn(),member:vi.fn(),access:vi.fn(),enabled:vi.fn(),db:{followUpTaskBatch:{findFirst:vi.fn()}}}))
vi.mock('@/server/db/client',()=>({prisma:{$transaction:m.tx}}))
vi.mock('../follow-up-task-batches',()=>({readTaskBatch:m.read}))
vi.mock('../follow-up-task-completion',()=>({previewTaskCompletion:m.complete}))
vi.mock('../follow-up-task-reschedule',()=>({previewTaskReschedule:m.reschedule}))
vi.mock('../follow-up-access',async original=>({...await original<typeof import('../follow-up-access')>(),lockFollowUpMember:m.member,currentFollowUpAccess:m.access,requireFollowUpWrites:m.enabled}))
import {reviewRemainingTasks} from '../follow-up-remaining-tasks'
const batchId='22222222-2222-4222-8222-222222222222',at='2026-11-06T00:00:00.000Z',version='a'.repeat(64)
const task=(i:number)=>({id:'task-'+i,title:'Current '+i,leadId:'lead',leadName:'Practice Clinic',dueDate:'2030-01-01T00:00:00.000Z',isComplete:false})
const detail=()=>({id:batchId,kind:'COMPLETE',canReview:true,createdAt:at,checkedAt:at,items:[{index:0,state:'failed',currentChanged:false,task:task(0)},{index:1,state:'not-attempted',currentChanged:false,task:task(1)},{index:2,state:'uncertain',currentChanged:false,task:task(2)},{index:3,state:'confirmed',currentChanged:false,task:task(3)},{index:4,state:'unavailable'}]})
beforeEach(()=>{vi.resetAllMocks();m.tx.mockImplementation(run=>run(m.db));m.access.mockResolvedValue({canWrite:true});m.db.followUpTaskBatch.findFirst.mockResolvedValue({id:batchId,kind:'COMPLETE',plan:Array.from({length:5},(_,i)=>({id:'source-'+i,input:{requestId:`${String(i+1).padStart(8,'0')}-1111-4111-8111-111111111111`,expectedVersion:version,taskId:'task-'+i}}))});m.read.mockImplementation(async()=>detail());m.complete.mockImplementation(async(_o,_u,id)=>({id,version,leadName:'Practice Clinic',task:{id:id.replace('source','task'),title:'Current task',description:'Current notes',assigneeId:'actor',assigneeName:'Owner',dueDate:'2030-01-01T00:00:00.000Z'}}))})
it('reviews only failed/unattempted open tasks with fresh previews and never writes or reuses request ids',async()=>{
 const result=await reviewRemainingTasks('org','actor',batchId,{indices:[0,1,2,3,4]});expect(result.items.map(r=>r.index)).toEqual([0,1]);expect(result.skipped).toEqual([{index:2,reason:'uncertain'},{index:3,reason:'confirmed'},{index:4,reason:'unavailable'}]);expect(m.complete).toHaveBeenCalledTimes(2);expect(m.read).toHaveBeenCalledTimes(2);expect(JSON.stringify(result)).not.toContain('requestId');expect(result.items[0].preview.version).toBe(version)
})
it('checks uncertain rows again but keeps missing receipts excluded',async()=>{const result=await reviewRemainingTasks('org','actor',batchId,{indices:[2]});expect(result.items).toEqual([]);expect(result.skipped).toEqual([{index:2,reason:'uncertain'}]);expect(m.complete).not.toHaveBeenCalled()})
it('excludes newly confirmed, completed, relinked and inaccessible tasks and propagates global permission loss',async()=>{
 const latest=detail();latest.items[0].state='confirmed';m.read.mockResolvedValueOnce(detail()).mockResolvedValue(latest);expect((await reviewRemainingTasks('org','actor',batchId,{indices:[0]})).skipped).toEqual([{index:0,reason:'confirmed'}])
 m.read.mockImplementation(async()=>detail());m.complete.mockRejectedValueOnce(new AppError('NOT_FOUND','safe',404));expect((await reviewRemainingTasks('org','actor',batchId,{indices:[0]})).skipped).toEqual([{index:0,reason:'unavailable'}]);m.complete.mockResolvedValueOnce({id:'source-0',version,leadName:'Practice Clinic',task:{id:'wrong'}});await expect(reviewRemainingTasks('org','actor',batchId,{indices:[0]})).rejects.toMatchObject({statusCode:409})
 m.complete.mockRejectedValueOnce(new AppError('FORBIDDEN','safe',403));await expect(reviewRemainingTasks('org','actor',batchId,{indices:[0]})).rejects.toMatchObject({statusCode:403})
})
it('rejects read-only, foreign ownership, invalid or duplicate indices and missing targets before previews',async()=>{
 m.access.mockRejectedValueOnce(new AppError('FORBIDDEN','safe',403));await expect(reviewRemainingTasks('org','reader',batchId,{indices:[0]})).rejects.toMatchObject({statusCode:403});m.db.followUpTaskBatch.findFirst.mockResolvedValueOnce(null);await expect(reviewRemainingTasks('org','other',batchId,{indices:[0]})).rejects.toMatchObject({statusCode:404})
 for(const indices of [[],[0,0],[20],Array.from({length:21},(_,i)=>i)])await expect(reviewRemainingTasks('org','actor',batchId,{indices})).rejects.toBeDefined();expect(m.complete).not.toHaveBeenCalled();expect(m.reschedule).not.toHaveBeenCalled()
})
it('uses an explicit new future local deadline and includes the exact fresh old/new target',async()=>{
 const d=detail();d.kind='RESCHEDULE';m.read.mockResolvedValue(d);m.db.followUpTaskBatch.findFirst.mockResolvedValue({kind:'RESCHEDULE',plan:[{id:'source-0',input:{taskId:'task-0',requestId:'11111111-1111-4111-8111-111111111111',expectedVersion:version,localTime:'2099-11-07T09:00',timeZone:'Asia/Manila'},previousDueDate:'2030-01-01T00:00:00.000Z',dueDate:'2099-11-07T01:00:00.000Z'}]});m.reschedule.mockImplementation(async(_o,_u,id,target)=>({...await m.complete(_o,_u,id),...target,newDueDate:'2099-11-07T01:00:00.000Z'}))
 const target={localTime:'2099-11-07T09:00',timeZone:'Asia/Manila'};const result=await reviewRemainingTasks('org','actor',batchId,{indices:[0],target});expect(result.kind).toBe('RESCHEDULE');expect(result.items[0].preview).toMatchObject({...target,newDueDate:'2099-11-07T01:00:00.000Z'});expect(m.reschedule).toHaveBeenCalledWith('org','actor','source-0',target)
 for(const chosen of [undefined,{localTime:'2000-01-01T09:00',timeZone:'Asia/Manila'},{localTime:'2099-11-07T09:00',timeZone:'Invalid/Zone'}])await expect(reviewRemainingTasks('org','actor',batchId,{indices:[0],target:chosen})).rejects.toBeDefined()
})
