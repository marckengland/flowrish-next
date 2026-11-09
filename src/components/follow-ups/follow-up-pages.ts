'use client'
import {FOLLOW_UP_TASK_ORDER_HEADER,compareTaskDeadline} from '@/lib/follow-up-task-order'
import {FOLLOW_UP_TASK_PROGRESS_HEADER,taskProgressSchema} from '@/lib/follow-up-task-progress'
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
  let taskProgress:boolean|undefined, taskOrder:boolean|undefined, orderVersion:string|undefined, inboxCounts=false, composeDrafts=false
  let callbackCatchUp:FollowUpPageMeta['callbackCatchUp']=undefined
  for(let n=0;n<input.depth;n++) {
    input.signal.throwIfAborted()
    const query=followUpListQuery(input.status,input.filters)
    if(after)query.set('after',after)
    for(const id of input.retained)query.append('retain',id)
    const result=await followUpData<T[]>(await fetch(`/api/follow-ups?${query}`,{method:'GET',cache:'no-store',headers:{...(input.context?followUpHeaders(input.context):{}),[FOLLOW_UP_PAGE_HEADER]:'1',[FOLLOW_UP_PROGRESS_HEADER]:'1',[FOLLOW_UP_TASK_PROGRESS_HEADER]:'1',[FOLLOW_UP_TASK_ORDER_HEADER]:'1'},signal:input.signal}),input.context)
    if(!Array.isArray(result.data)||result.data.some(row=>!row||typeof row.id!=='string'))throw new Error('Unexpected follow-up page. Refresh to try again.')
    if(input.filters.taskProgress&&!result.taskProgress)throw new Error('Task progress filters are unavailable. Reload or clear this filter.')
    if(n>0&&taskProgress!==Boolean(result.taskProgress))throw new FollowUpClientError('Task access changed while loading. Reload before continuing.',409,'FOLLOW_UP_CONTEXT_CHANGED')
    if(input.filters.taskOrder&&(!result.taskOrder||!result.taskProgress))throw new Error('Task deadline ordering is unavailable. Reload or choose Newest follow-ups.')
    inboxCounts=n===0?result.inboxCounts===true:inboxCounts&&result.inboxCounts===true
    composeDrafts=n===0?result.composeDrafts===true:composeDrafts&&result.composeDrafts===true
    taskOrder=Boolean(result.taskOrder)
    taskProgress=Boolean(result.taskProgress)
    if(taskProgress&&input.status==='APPROVED')for(const row of result.data){const value=row as T&{status?:unknown;taskProgress?:unknown};if(value.status==='APPROVED')taskProgressSchema.parse(value.taskProgress)}
    const page=result.page===undefined&&!after?null:followUpPageMeta.parse(result.page)
    if(input.filters.taskOrder){
      if(!page?.orderVersion||orderVersion!==undefined&&page.orderVersion!==orderVersion)throw new FollowUpClientError('Task deadlines or matching work changed. Refresh the list; unsent drafts are kept.',409,'FOLLOW_UP_ORDER_CHANGED')
      orderVersion=page.orderVersion
    }
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
  return {...(composeDrafts?{composeDrafts:true as const}:{}),...(inboxCounts?{inboxCounts:true as const}:{}),...(taskOrder?{taskOrder:true as const}:{}),...(taskProgress?{taskProgress:true as const}:{}),callbackCatchUp,paged:accessVersion!==undefined,items:[...items.values()].sort(input.filters.taskOrder?compareTaskDeadline:(a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||(a.id<b.id?-1:a.id>b.id?1:0)),nextCursor,canWrite,pages}
}
