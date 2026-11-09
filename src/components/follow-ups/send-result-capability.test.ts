import {afterEach,expect,it,vi} from 'vitest'
import {readFollowUpPages} from './follow-up-pages'
const context={organizationId:'org',userId:'actor'}
afterEach(()=>vi.unstubAllGlobals())
it.each([[true,true,true],[true,false,undefined],[false,false,undefined]])('enables send recovery only when every loaded page supports it: %s/%s',async(first,second,want)=>{let count=0;vi.stubGlobal('fetch',vi.fn<typeof fetch>().mockImplementation(async()=>{const enabled=count++===0?first:second;return new Response(JSON.stringify({data:[{id:'a',createdAt:'2026-11-09T00:00:00Z'}],scope:context,capabilities:{canWrite:true,...(enabled?{sendResults:true}:{})},page:{nextCursor:count===1?'next':null,accessVersion:'a'.repeat(64)}}))}));const result=await readFollowUpPages({status:'PENDING',filters:{search:'',source:'ALL',dueOnly:false},context,depth:2,retained:[],signal:new AbortController().signal});expect(result.pages).toBe(2);expect((result as {sendResults?:true}).sendResults).toBe(want)})
