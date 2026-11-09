'use client'
import {useEffect,useRef,useState} from 'react'
import {Button} from '@/components/ui/button'
import {followUpHeaders,type FollowUpContext} from '@/lib/follow-up-access'
import {followUpData,followUpAccessLost,FollowUpClientError} from '@/lib/follow-up-client'
import {emailSendResult} from '@/lib/email-send-result'
import {sendStatusLabel,type SendStatusMetadata} from '@/lib/follow-up-send-status'
export type SendStatusSignal={metadata:SendStatusMetadata;busy:boolean}
type Props={id:string;initial?:SendStatusMetadata;signal?:SendStatusSignal;context:FollowUpContext;onAccessLost:(cause?:unknown)=>void;onHoldChange?:(hold:boolean)=>void;onChecked?:()=>void}
export function FollowUpSendStatusCard(props:Props){
 const latest=useRef(props);latest.current=props
 const [snapshot,setSnapshot]=useState<SendStatusMetadata|undefined>(props.initial),[checking,setChecking]=useState(false),[error,setError]=useState(''),[offline,setOffline]=useState(false)
 const initialState=props.initial?.state,initialUpdatedAt=props.initial?.updatedAt
 const accepted=useRef(props.initial?.state==='CONFIRMED')
 const protectedState=useRef(false),alive=useRef(true),version=useRef(0),request=useRef<AbortController|null>(null)
 useEffect(()=>{if(!protectedState.current&&(!accepted.current||initialState==='CONFIRMED')){accepted.current ||= initialState==='CONFIRMED';setSnapshot(initialState?{state:initialState,updatedAt:initialUpdatedAt??null}:undefined)}},[initialState,initialUpdatedAt])
 useEffect(()=>{
  if(!props.signal)return
  version.current++;request.current?.abort();request.current=null;setChecking(false);protectedState.current=props.signal.busy||['UNKNOWN','CONFIRMED'].includes(props.signal.metadata.state);if(!accepted.current||props.signal.metadata.state==='CONFIRMED')setSnapshot(props.signal.metadata);accepted.current ||= props.signal.metadata.state==='CONFIRMED';setError('');latest.current.onHoldChange?.(!accepted.current&&props.signal.metadata.state==='UNKNOWN'&&!props.signal.busy)
 },[props.signal])
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;request.current?.abort()}},[])
 useEffect(()=>{
  setOffline(!navigator.onLine)
  const change=()=>{setOffline(!navigator.onLine);if(!navigator.onLine&&request.current){version.current++;request.current.abort();request.current=null;setChecking(false);protectedState.current=true;setError('Send status could not be checked. Your current work is kept.');latest.current.onHoldChange?.(true)}}
  window.addEventListener('online',change);window.addEventListener('offline',change)
  return()=>{window.removeEventListener('online',change);window.removeEventListener('offline',change)}
 },[])
 async function check(){
  if(request.current||!navigator.onLine||latest.current.signal?.busy)return
  const seq=++version.current,controller=new AbortController(),captured=latest.current
  request.current=controller;setChecking(true);setError('')
  const active=()=>alive.current&&!controller.signal.aborted&&seq===version.current
  try{
   const response=await followUpData<unknown>(await fetch(`/api/follow-ups/${encodeURIComponent(captured.id)}/send-result`,{method:'GET',cache:'no-store',headers:followUpHeaders(captured.context),signal:controller.signal}),captured.context)
   if(!active())return
   if(response.canWrite!==true)throw new FollowUpClientError('Send access changed. Reload before continuing.',409,'FOLLOW_UP_CONTEXT_CHANGED')
   const value=emailSendResult.parse(response.data);if(value.id!==captured.id)throw new Error('Send status changed.')
   protectedState.current=true;if(!accepted.current||value.state==='CONFIRMED')setSnapshot({state:value.state,updatedAt:value.updatedAt});accepted.current ||= value.state==='CONFIRMED';latest.current.onHoldChange?.(false);latest.current.onChecked?.()
  }catch(cause){
   if(!active())return
   if(followUpAccessLost(cause)){accepted.current=false;setSnapshot(undefined);setError('');latest.current.onHoldChange?.(false);latest.current.onAccessLost(cause);return}
   protectedState.current=true;setError('Send status could not be checked. Your current work is kept.');latest.current.onHoldChange?.(true)
  }finally{if(active()){request.current=null;setChecking(false)}}
 }
 const label=snapshot?sendStatusLabel(snapshot):null
 return <section aria-label="Follow-up send status" className="space-y-2 pt-2"><div className="flex flex-wrap items-center gap-2">{label&&<span role="status" className="rounded-full border bg-muted px-2 py-0.5 text-xs font-medium">{label}</span>}<Button type="button" variant="ghost" size="sm" disabled={checking||offline||props.signal?.busy} onClick={()=>void check()}>{checking?'Checking send status…':'Check send status'}</Button>{offline&&<span className="text-xs text-muted-foreground">Offline</span>}</div>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}{snapshot?.state==='CONFIRMED'&&<p className="text-xs text-muted-foreground">Acceptance does not confirm inbox delivery.</p>}</section>
}
