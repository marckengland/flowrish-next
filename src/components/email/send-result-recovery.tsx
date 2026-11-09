'use client'
import {useCallback,useEffect,useRef,useState} from 'react'
import {Button} from '@/components/ui/button'
import {followUpHeaders,type FollowUpContext} from '@/lib/follow-up-access'
import {followUpData,followUpAccessLost,FollowUpClientError} from '@/lib/follow-up-client'
import {emailSendResult,type EmailSendReceipt,type EmailSendResult} from '@/lib/email-send-result'
type Input={enabled:boolean;id?:string;context?:FollowUpContext;paused:boolean;onAccessLost:()=>void}
type Model={phase:'checking'|'ready'|'error'|'sending';record:EmailSendResult|null}
export function useSendResultRecovery(input:Input){
 const optedIn=useRef(input.enabled);optedIn.current ||= input.enabled
 const enabled=Boolean(optedIn.current&&input.id&&input.context),id=input.id,organizationId=input.context?.organizationId,userId=input.context?.userId,latest=useRef(input);latest.current=input
 const [model,setModel]=useState<Model>({phase:'checking',record:null}),modelRef=useRef(model);modelRef.current=model
 const [offline,setOffline]=useState(false),offlineRef=useRef(false),alive=useRef(false),version=useRef(0),controller=useRef<AbortController|null>(null),pending=useRef<{operationId:string;version:number}|null>(null),inFlight=useRef(false)
 const read=useCallback(async()=>{
  if(!enabled||inFlight.current||offlineRef.current||latest.current.paused)return
  const seq=++version.current,request=new AbortController();controller.current?.abort();controller.current=request
  setModel(previous=>({...previous,phase:'checking'}))
  try{
   const context={organizationId:organizationId!,userId:userId!}
   const response=await fetch(`/api/follow-ups/${encodeURIComponent(id!)}/send-result`,{method:'GET',cache:'no-store',headers:followUpHeaders(context),signal:request.signal})
   const value=await followUpData<unknown>(response,context)
   if(!alive.current||request.signal.aborted||seq!==version.current)return
   if(value.canWrite!==true)throw new FollowUpClientError('Access changed. Reload before continuing.',409,'FOLLOW_UP_CONTEXT_CHANGED')
   const record=emailSendResult.parse(value.data);if(record.id!==id)throw new Error('Send status changed.')
   pending.current=null;setModel({phase:'ready',record})
  }catch(error){
   if(!alive.current||request.signal.aborted||seq!==version.current)return
   if(followUpAccessLost(error)){setModel({phase:'error',record:null});latest.current.onAccessLost();return}
   setModel(previous=>({...previous,phase:'error'}))
  }
 },[enabled,id,organizationId,userId])
 useEffect(()=>{alive.current=true;void read();return()=>{alive.current=false;controller.current?.abort()}},[read])
 useEffect(()=>{
  if(!enabled)return
  const change=()=>{const value=!navigator.onLine;offlineRef.current=value;setOffline(value);version.current++;controller.current?.abort();setModel(previous=>({...previous,phase:'error'}))}
  offlineRef.current=!navigator.onLine;setOffline(offlineRef.current)
  if(offlineRef.current){version.current++;controller.current?.abort();setModel(previous=>({...previous,phase:'error'}))}
  window.addEventListener('offline',change);window.addEventListener('online',change)
  return()=>{window.removeEventListener('offline',change);window.removeEventListener('online',change)}
 },[enabled])
 const blocked=enabled&&(offline||input.paused||model.phase!=='ready'||!model.record||!['NONE','FAILED'].includes(model.record.state))
 const start=()=>{
  if(!enabled)return undefined
  const current=modelRef.current
  if(inFlight.current||offlineRef.current||latest.current.paused||current.phase!=='ready'||!current.record||!['NONE','FAILED'].includes(current.record.state))throw new Error('Check send status before sending.')
  const operationId=crypto.randomUUID();pending.current={operationId,version:version.current};inFlight.current=true;setModel(previous=>({...previous,phase:'sending'}));return operationId
 }
 const confirmed=(raw:unknown,result:EmailSendReceipt,operationId?:string)=>{
  if(!enabled)return
  const attempt=pending.current,record=emailSendResult.parse(raw)
  if(!alive.current||offlineRef.current||!attempt||attempt.operationId!==operationId||attempt.version!==version.current||record.id!==id||record.operationId!==operationId||record.state!=='CONFIRMED'||JSON.stringify(record.result)!==JSON.stringify(result))throw new Error('The send confirmation could not be verified. Check send status.')
  inFlight.current=false;pending.current=null;setModel({phase:'ready',record})
 }
 const failed=()=>{if(!enabled)return;inFlight.current=false;if(alive.current)setModel(previous=>({...previous,phase:'error'}))}
 return {enabled,blocked,offline,model,read:()=>void read(),start,confirmed,failed,checking:model.phase==='checking'||model.phase==='sending',paused:input.paused}
}
export function SendResultRecovery({state}:{state:ReturnType<typeof useSendResultRecovery>}){
 if(!state.enabled)return null
 const record=state.model.record,message=state.offline?'Offline. Your edits stay here. Check send status when connected.':state.model.phase==='checking'?'Checking send status…':state.model.phase==='sending'?'Waiting for send confirmation…':state.model.phase==='error'?'Send status is unconfirmed. Your edits are kept. Check again before sending.':record?.state==='CONFIRMED'?'Provider accepted this follow-up email. Another send is blocked.':record?.state==='UNKNOWN'?'The send result is unknown. Another send is blocked. Check sent mail.':record?.state==='FAILED'?'The provider send call did not start. You can make a new explicit attempt.':'No send attempt is recorded. Sending requires your action.'
 return <section aria-label="Send recovery" className="space-y-2 rounded-lg border p-3 text-sm"><p role="status" aria-live="polite">{message}</p><p className="text-xs text-muted-foreground">Checking reads Flowrish’s saved result only. Provider acceptance does not prove inbox delivery. Your current edits are kept.</p><Button type="button" variant="outline" size="sm" disabled={state.offline||state.checking||state.paused} onClick={state.read}>Check send status</Button></section>
}
