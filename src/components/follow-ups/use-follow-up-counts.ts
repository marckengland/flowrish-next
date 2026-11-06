'use client'
import {useEffect,useState} from 'react'
import {followUpCountsSchema,followUpCountsQuery,followUpCountsFilterKey,type FollowUpCounts} from '@/lib/follow-up-counts'
import type {FollowUpFilters} from '@/lib/follow-up-filters'
import {followUpHeaders,type FollowUpContext} from '@/lib/follow-up-access'
import {FollowUpClientError} from '@/lib/follow-up-client'
import {EMAIL_NOTIFICATION_EVENT} from '@/lib/email-notifications'
type Props={context?:FollowUpContext;filters:FollowUpFilters;enabled:boolean;revision:number;onAccessLost:(cause:unknown)=>void}
type Snapshot={key:string;status:'loading'|'ready'|'error';data?:FollowUpCounts}
export function useFollowUpCounts({context,filters,enabled,revision,onAccessLost}:Props){
 const organizationId=context?.organizationId,userId=context?.userId,filterKey=followUpCountsFilterKey(filters)
 const [retry,setRetry]=useState(0),[snapshot,setSnapshot]=useState<Snapshot|null>(null)
 const key=JSON.stringify([organizationId,userId,filterKey,revision,retry])
 useEffect(()=>{
  if(!enabled||!organizationId||!userId){setSnapshot(null);return}
  let live=true,sequence=0,controller:AbortController|null=null
  const scope={organizationId,userId},applied=JSON.parse(filterKey) as FollowUpFilters
  async function load(){
   const current=++sequence;controller?.abort();const request=new AbortController();controller=request
   const active=()=>live&&sequence===current&&!request.signal.aborted
   setSnapshot({key,status:'loading'})
   try{
    const query=followUpCountsQuery(applied).toString(),response=await fetch('/api/follow-ups/counts'+(query?'?'+query:''),{method:'GET',cache:'no-store',headers:followUpHeaders(scope),signal:request.signal})
    if(!active())return
    if(response.status===401||response.status===403)throw new FollowUpClientError('Current inbox access is unavailable. Reload before continuing.',response.status,'FORBIDDEN')
    const value=await response.json()
    if(!active())return
    if(!response.ok)throw new FollowUpClientError(value?.error?.message??'Counts are unavailable. Try again.',response.status,value?.error?.code??'')
    if(typeof value?.scope?.organizationId!=='string'||typeof value?.scope?.userId!=='string')throw new Error('Count scope could not be verified.')
    if(value.scope.organizationId!==organizationId||value.scope.userId!==userId)throw new FollowUpClientError('The account or business changed. Reload before continuing.',409,'FOLLOW_UP_CONTEXT_CHANGED')
    if(typeof value?.capabilities?.canWrite!=='boolean')throw new Error('Count permissions could not be verified.')
    const data=followUpCountsSchema.parse(value.data)
    if(followUpCountsFilterKey(data.filters)!==filterKey)throw new Error('Count filters could not be verified.')
    setSnapshot({key,status:'ready',data})
   }catch(cause){
    if(!active())return
    setSnapshot({key,status:'error'})
    if(cause instanceof FollowUpClientError&&([401,403].includes(cause.status)||/CONTEXT|WORKSPACE/.test(cause.code)))onAccessLost(cause)
   }
  }
  void load()
  const refresh=()=>void load();window.addEventListener(EMAIL_NOTIFICATION_EVENT,refresh)
  return()=>{live=false;sequence++;controller?.abort();window.removeEventListener(EMAIL_NOTIFICATION_EVENT,refresh)}
 },[enabled,organizationId,userId,filterKey,key,onAccessLost])
 const current=enabled&&snapshot?.key===key?snapshot:null
 return {status:!enabled?'idle' as const:current?.status??'loading' as const,data:current?.status==='ready'?current.data:undefined,refresh:()=>setRetry(value=>value+1)}
}
