import {afterEach,expect,it,vi} from 'vitest'
import {readFollowUpPages} from './follow-up-pages'
const scope={organizationId:'org',userId:'actor'},input={status:'PENDING',filters:{search:'',source:'ALL' as const,dueOnly:false},context:scope,depth:1,retained:[],signal:new AbortController().signal}
afterEach(()=>vi.restoreAllMocks())
it.each([false,true])('advertises aggregate reads only when the list advertises counts: %s',async enabled=>{vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({data:[],scope,capabilities:{canWrite:true,...(enabled?{inboxCounts:true}:{})}})));const result=await readFollowUpPages(input);if(enabled)expect(result).toHaveProperty('inboxCounts',true);else expect(result).not.toHaveProperty('inboxCounts')})
