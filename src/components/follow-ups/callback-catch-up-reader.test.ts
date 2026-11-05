import {afterEach,expect,it,vi} from 'vitest'
import {readFollowUpPages} from './follow-up-pages'
const context={organizationId:'org',userId:'actor'},receipt={created:100,hasMore:true},input={status:'PENDING',filters:{search:'',source:'ALL' as const,dueOnly:false},context,depth:2,retained:[],signal:new AbortController().signal}
const response=(nextCursor:string|null,callbackCatchUp?:unknown)=>new Response(JSON.stringify({data:[],page:{nextCursor,accessVersion:'a'.repeat(64),...(callbackCatchUp?{callbackCatchUp}:{})},scope:context,capabilities:{canWrite:true}}))
afterEach(()=>vi.unstubAllGlobals())
it('preserves the root catch-up receipt across read-only continuations',async()=>{const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(response('cursorA',receipt)).mockResolvedValueOnce(response(null));vi.stubGlobal('fetch',fetcher);const result=await readFollowUpPages(input);expect(result).toMatchObject({callbackCatchUp:receipt,pages:2});expect(fetcher).toHaveBeenCalledTimes(2)})
it('rejects impossible batch counts rather than displaying unconfirmed progress',async()=>{for(const created of [-1,101,0.5]){vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response(null,{created,hasMore:true})));await expect(readFollowUpPages(input)).rejects.toThrow()}})
it('does not let a continuation receipt replace the root confirmation',async()=>{vi.stubGlobal('fetch',vi.fn<typeof fetch>().mockResolvedValueOnce(response('cursorA',receipt)).mockResolvedValueOnce(response(null,{created:0,hasMore:false})));expect((await readFollowUpPages(input)).callbackCatchUp).toEqual(receipt)})
