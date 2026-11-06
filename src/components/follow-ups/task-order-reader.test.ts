import { afterEach, expect, it, vi } from 'vitest'
import { readFollowUpPages } from './follow-up-pages'
const scope = {organizationId:'org',userId:'actor'}, createdAt='2026-11-06T00:00:00.000Z', version='a'.repeat(64)
const row=(id:string,dueDate:string|null)=>({id,createdAt,status:'APPROVED',taskProgress:dueDate?{state:'OPEN',dueDate,completedAt:null,checkedAt:createdAt}:{state:'UNAVAILABLE'}})
const input=()=>({status:'APPROVED',filters:{search:'',source:'ALL' as const,dueOnly:false,taskOrder:'DUE_ASC' as const},context:scope,depth:2,retained:[],signal:new AbortController().signal})
const reply=(data:unknown[],nextCursor:string|null=null,orderVersion:string|null=version,supported=true)=>new Response(JSON.stringify({data,scope,capabilities:{canWrite:false,taskProgress:true,...(supported?{taskOrder:true}:{})},page:{nextCursor,accessVersion:version,...(orderVersion?{orderVersion}:{})}}))
afterEach(()=>vi.unstubAllGlobals())
it('merges ordered pages and retained copies with unavailable deadlines last using only opted-in GETs',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(reply([row('late','2099-01-01T00:00:00.000Z'),row('early','2020-01-01T00:00:00.000Z')],'next')).mockResolvedValueOnce(reply([row('missing',null)]));vi.stubGlobal('fetch',fetcher)
 const result=await readFollowUpPages(input());expect(result.items.map(row=>row.id)).toEqual(['early','late','missing']);expect(result.taskOrder).toBe(true);expect(fetcher).toHaveBeenCalledTimes(2)
 for(const [path,init] of fetcher.mock.calls){expect(path).toContain('taskOrder=DUE_ASC');expect(init.method).toBe('GET');expect(init.headers).toMatchObject({'x-flowrish-task-order':'1'})}
})
it('rejects missing capability, absent fingerprints and changed ordering without treating it as lost access',async()=>{
 for(const pages of [[reply([],null,version,false)],[reply([],null,null)],[reply([],'next'),reply([],null,'b'.repeat(64))]]){
  const fetcher=vi.fn();for(const response of pages)fetcher.mockResolvedValueOnce(response);vi.stubGlobal('fetch',fetcher)
  await expect(readFollowUpPages(input())).rejects.toThrow();expect(fetcher).toHaveBeenCalledTimes(pages.length)
 }
})
