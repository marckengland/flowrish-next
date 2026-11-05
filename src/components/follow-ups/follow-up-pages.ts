'use client'
import {FOLLOW_UP_PAGE_HEADER,FOLLOW_UP_PROGRESS_HEADER,followUpPageMeta,type FollowUpPageMeta} from '@/lib/follow-up-page'
import {followUpListQuery,type FollowUpFilters} from '@/lib/follow-up-filters'
import {followUpHeaders,type FollowUpContext} from '@/lib/follow-up-access'
import {followUpData,FollowUpClientError} from '@/lib/follow-up-client'
type Input={status:string;filters:FollowUpFilters;context?:FollowUpContext;depth:number;retained:readonly string[];signal:AbortSignal}
/** Refresh a contiguous window, then merge once so keyed drafts stay mounted. */
export async function readFollowUpPages<T extends {id:string;createdAt:string}>(input:Input) {
  if(input.retained.length>100)throw new Error('Finish or close some editors before loading more; up to 100 edited or selected follow-ups can be retained at once.')
  const items=new Map<string,T>(),seen=new Set<string>()
  let after:string|undefined,nextCursor:string|null=null,accessVersion:string|undefined,canWrite:boolean|undefined,pages=0
  let callbackCatchUp:FollowUpPageMeta['callbackCatchUp']=undefined
  for(let n=0;n<input.depth;n++) {
    input.signal.throwIfAborted()
    const query=followUpListQuery(input.status,input.filters)
    if(after)query.set('after',after)
    for(const id of input.retained)query.append('retain',id)
    const result=await followUpData<T[]>(await fetch(`/api/follow-ups?${query}`,{method:'GET',cache:'no-store',headers:{...(input.context?followUpHeaders(input.context):{}),[FOLLOW_UP_PAGE_HEADER]:'1',[FOLLOW_UP_PROGRESS_HEADER]:'1'},signal:input.signal}),input.context)
    if(!Array.isArray(result.data)||result.data.some(row=>!row||typeof row.id!=='string'))throw new Error('Unexpected follow-up page. Refresh to try again.')
    const page=result.page===undefined&&!after?null:followUpPageMeta.parse(result.page)
    if(accessVersion!==undefined&&page?.accessVersion!==accessVersion)throw new FollowUpClientError('Permissions changed while loading follow-ups. Reload before continuing.',409,'FOLLOW_UP_CONTEXT_CHANGED')
    if(n===0)callbackCatchUp=page?.callbackCatchUp
    if(page)accessVersion=page.accessVersion
    for(const row of result.data)items.set(row.id,row)
    // Every page rechecks all retained IDs; an omission revokes an earlier copy.
    const present=new Set(result.data.map(row=>row.id))
    for(const id of input.retained)if(!present.has(id))items.delete(id)
    canWrite=result.canWrite;pages++;nextCursor=page?.nextCursor??null
    if(!nextCursor)break
    if(seen.has(nextCursor))throw new Error('The follow-up cursor did not advance. Refresh to try again.')
    seen.add(nextCursor);after=nextCursor
  }
  return {callbackCatchUp,paged:accessVersion!==undefined,items:[...items.values()].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||(a.id<b.id?-1:a.id>b.id?1:0)),nextCursor,canWrite,pages}
}
