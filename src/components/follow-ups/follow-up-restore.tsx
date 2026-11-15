'use client'
import {useEffect,useRef,useState} from 'react'
import {Button} from '@/components/ui/button'
import {followUpHeaders,type FollowUpContext} from '@/lib/follow-up-access'
import {followUpAccessLost,followUpData,FollowUpClientError} from '@/lib/follow-up-client'
import {followUpRestoreInput,followUpRestorePreview,followUpRestoreReceipt,type FollowUpRestoreInput,type FollowUpRestorePreview,type FollowUpRestoreReceipt} from '@/lib/follow-up-restore'
type Props={id:string;taskId:string|null;dismissed:boolean;context:FollowUpContext;canWrite:boolean;disabled:boolean;onChanged:(receipt:Extract<FollowUpRestoreReceipt,{state:'confirmed'}>)=>void;onBusyChange:(busy:boolean)=>void;onWorkChange:(work:boolean)=>void;onAccessLost:(cause:unknown,id:string)=>void}
const identityFor=(p:Props)=>JSON.stringify([p.context.organizationId,p.context.userId,p.id])
const keyFor=(p:Props)=>JSON.stringify([identityFor(p),p.taskId])
export function FollowUpRestore(props:Props){
 const [review,setReview]=useState<FollowUpRestorePreview|null>(null),[plan,setPlan]=useState<FollowUpRestoreInput|null>(null)
 const [busy,setBusy]=useState(false),[done,setDone]=useState(false),[lost,setLost]=useState(false),[offline,setOffline]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const latest=useRef(props),live=useRef(true),writing=useRef(false),generation=useRef(0),controller=useRef<AbortController|null>(null),capturedKey=useRef(keyFor(props)),identity=useRef(identityFor(props)),pending=useRef(false),pendingTaskId=useRef<string|null>(props.taskId)
 latest.current=props
 const work=Boolean(review||plan||done),onWorkChange=props.onWorkChange,key=keyFor(props)
 useEffect(()=>{onWorkChange(work);return()=>onWorkChange(false)},[work,onWorkChange])
 useEffect(()=>{const life=live,counter=generation,request=controller,running=writing,current=latest;life.current=true;return()=>{life.current=false;counter.current++;request.current?.abort();if(running.current)current.current.onBusyChange(false)}},[])
 function revoke(cause:unknown){generation.current++;controller.current?.abort();controller.current=null;writing.current=false;pending.current=false;setBusy(false);setReview(null);setPlan(null);setDone(false);setError('');setNotice('');setLost(true);latest.current.onBusyChange(false);latest.current.onAccessLost(cause,latest.current.id)}
 useEffect(()=>{
  if(!latest.current.canWrite||identity.current!==identityFor(latest.current)){revoke(new FollowUpClientError('Access changed. Reload before restoring.',409,'FOLLOW_UP_CONTEXT_CHANGED'));return}
  if(capturedKey.current===key)return
  capturedKey.current=key;generation.current++;controller.current?.abort();controller.current=null;writing.current=false;setBusy(false);latest.current.onBusyChange(false);setReview(null);setDone(false)
  if(pending.current)setError('The linked task changed. Check the original restore result before continuing.')
  else{setError('');setNotice('The linked task changed. Review again before restoring.')}
 },[props.canWrite,key])
 useEffect(()=>{if(!props.dismissed&&!plan&&!done)setReview(null)},[props.dismissed,plan,done])
 useEffect(()=>{
  setOffline(!navigator.onLine)
  const change=()=>{
   setOffline(!navigator.onLine)
   if(navigator.onLine||!controller.current)return
   generation.current++;controller.current.abort();controller.current=null;writing.current=false;setBusy(false);setReview(null);latest.current.onBusyChange(false)
   setError(pending.current?'Restore is not confirmed. Check the result before taking another action.':'The restore review could not be verified. Your work is kept.')
  }
  window.addEventListener('offline',change);window.addEventListener('online',change)
  return()=>{window.removeEventListener('offline',change);window.removeEventListener('online',change)}
 },[])
 async function execute(kind:'review'|'confirm'|'check'){
  const start=latest.current
  if(writing.current||start.disabled||!start.canWrite||lost||!navigator.onLine||kind==='review'&&(!start.dismissed||plan)||kind==='confirm'&&(!start.dismissed||!review||plan)||kind==='check'&&!plan)return
  writing.current=true;setBusy(true);start.onBusyChange(true);setError('');setNotice('')
  const seq=++generation.current,request=new AbortController(),key=keyFor(start),endpoint='/api/follow-ups/'+encodeURIComponent(start.id)+'/restore'
  controller.current=request
  const active=()=>live.current&&seq===generation.current&&!request.signal.aborted&&latest.current.canWrite&&keyFor(latest.current)===key
  const read=async(url:string,init?:RequestInit)=>{
   let timer:ReturnType<typeof setTimeout>|undefined
   try{return await Promise.race([(async()=>{
    const value=await followUpData<unknown>(await fetch(url,{...init,cache:'no-store',signal:request.signal,headers:{...followUpHeaders(start.context),...(init?.headers??{})}}),start.context)
    if(value.canWrite!==true)throw new FollowUpClientError('Current editing access changed. Reload before restoring.',409,'FOLLOW_UP_CONTEXT_CHANGED')
    return value.data
   })(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('The restore review could not be verified. Your work is kept.')),15000)})])}finally{clearTimeout(timer)}
  }
  let submitted=false
  try{
   if(kind==='review'){
    setReview(null)
    const value=followUpRestorePreview.safeParse(await read(endpoint));if(!active())return
    if(!value.success||value.data.id!==start.id||(value.data.task?.id??null)!==start.taskId)throw new Error('The restore review could not be verified. Refresh and review again.')
    if(latest.current.dismissed)setReview(value.data)
   }else{
    const input=kind==='check'?plan!:followUpRestoreInput.parse({requestId:crypto.randomUUID(),expectedVersion:review!.version})
    if(kind==='confirm'){pending.current=true;pendingTaskId.current=start.taskId;setPlan(input);submitted=true}
    const raw=kind==='check'?await read(endpoint+'?requestId='+input.requestId):await read(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)})
    if(!active())return
    const value=followUpRestoreReceipt.safeParse(raw)
    if(!value.success||value.data.id!==start.id||value.data.requestId!==input.requestId||value.data.state==='confirmed'&&value.data.taskId!==(kind==='check'?pendingTaskId.current:start.taskId))throw new Error('The restore receipt could not be verified.')
    setReview(null);setPlan(null);pending.current=false
    if(value.data.state==='confirmed'){setDone(true);latest.current.onChanged(value.data)}
    else setNotice(value.data.state==='not-recorded'?'No restore was recorded for this request. Review again before confirming.':'This follow-up changed after the request. Refresh and review it again.')
   }
  }catch(cause){
   if(!active())return
   if(followUpAccessLost(cause)){revoke(cause);return}
   if(cause instanceof FollowUpClientError&&[400,409,413].includes(cause.status)){setReview(null);setPlan(null);pending.current=false;setError(cause.message)}
   else if(submitted||kind==='check'){setReview(null);setError('Restore is not confirmed. Check the result before taking another action.')}
   else setError('The restore review could not be verified. Your work is kept.')
  }finally{request.abort();if(live.current&&seq===generation.current){controller.current=null;writing.current=false;setBusy(false);latest.current.onBusyChange(false)}}
 }
 if(!props.canWrite||lost||!props.dismissed&&!plan&&!done&&!review&&!notice)return null
 return <section aria-label="Restore follow-up" aria-busy={busy} className="mt-4 space-y-3 rounded-lg border p-3">
  {done?<><p role="status" className="text-sm font-medium">Restore confirmed. This review is now Pending.</p><p className="text-xs text-muted-foreground">Task links, drafts and send protections are kept. Refresh the list when you are ready to reapply its filters.</p><Button type="button" variant="outline" onClick={()=>setDone(false)}>Close restore result</Button></>:<>
   {!review&&!plan&&props.dismissed&&<Button type="button" variant="outline" disabled={busy||offline||props.disabled} onClick={()=>void execute('review')}>Review restore</Button>}
   {review&&!plan&&<div role="group" aria-label="Restore review" className="space-y-2 text-sm"><p className="font-medium">Restore this review to Pending?</p><p className="break-words">{review.title}</p><p className="break-words">Lead: {review.leadName}</p>{review.task?<p className="break-words">{review.task.title}</p>:<p>No linked task. Restoring will not create one.</p>}<p className="text-xs text-muted-foreground">Existing task links, task status, draft text and send protections stay the same. No email is sent.</p>{review.clearsSnooze&&<p>Your old personal snooze will be cleared so this review appears in Pending.</p>}<div className="flex flex-wrap gap-2"><Button type="button" disabled={busy||offline||props.disabled||!props.dismissed} onClick={()=>void execute('confirm')}>Confirm restore to Pending</Button><Button type="button" variant="outline" disabled={busy} onClick={()=>{setReview(null);setError('')}}>Cancel restore</Button></div></div>}
   {plan&&<><p className="text-xs text-muted-foreground">Check reads this exact request. It never repeats the restore.</p><Button type="button" variant="outline" disabled={busy||offline||props.disabled} onClick={()=>void execute('check')}>Check restore result</Button></>}
  </>}
  {busy&&<p role="status" className="text-sm">Checking restore…</p>}{offline&&<p className="text-xs text-muted-foreground">Offline. Reconnect before reviewing or checking.</p>}{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}{notice&&<p role="status" className="text-sm">{notice}</p>}
 </section>
}
