'use client'
import {useCallback,useEffect,useRef,useState} from 'react'
import {Button} from '@/components/ui/button'
import {COMPOSE_BINDING_HEADER,composeDraftSnapshot,composeDraftWrite,type ComposeDraftBinding,type ComposeDraftContent,type ComposeDraftSnapshot,type ComposeDraftWrite} from '@/lib/compose-draft'
import {followUpHeaders,type FollowUpContext} from '@/lib/follow-up-access'
import {followUpAccessLost,followUpData,FollowUpClientError} from '@/lib/follow-up-client'
type Mode='loading'|'ready'|'review'|'saving'|'checking'|'error'|'blocked'
type Input={enabled:boolean;id?:string;context?:FollowUpContext;binding:ComposeDraftBinding;subject:string;body:string;paused:boolean;onRestore:(content:ComposeDraftContent)=>void;onAccessLost:()=>void}
type Model={mode:Mode;snapshot:ComposeDraftSnapshot|null;ack:string;message:string}
const serialize=(value:ComposeDraftContent|null)=>JSON.stringify(value)
const sourceKey=(input:Input)=>JSON.stringify([input.context?.organizationId,input.context?.userId,input.id,input.binding])
export function useComposeDraftRecovery(input:Input){
 const current=useRef(input);current.current=input
 const initial=useRef(serialize({subject:input.subject,body:input.body})),session=useRef<string|null>(null)
 const enabled=Boolean(input.enabled&&input.id&&input.context)
 if(enabled&&session.current===null)session.current=sourceKey(input)
 const sent=useRef<string|null>(null)
 const changed=enabled&&session.current!==sourceKey(input)
 const [model,setModel]=useState<Model>({mode:'loading',snapshot:null,ack:initial.current,message:''}),modelRef=useRef(model);modelRef.current=model
 const [offline,setOffline]=useState(false),offlineRef=useRef(false),live=useRef(false),sequence=useRef(0),controller=useRef<AbortController|null>(null),pending=useRef<ComposeDraftWrite|null>(null)
 const valid=useCallback(()=>live.current&&current.current.enabled&&session.current===sourceKey(current.current),[])
 const local=()=>({subject:current.current.subject,body:current.current.body})
 const accessError=useCallback((error:unknown)=>{if(followUpAccessLost(error)){sequence.current++;controller.current?.abort();pending.current=null;initial.current='';setModel({mode:'blocked',snapshot:null,ack:'',message:'Access changed. Reload before continuing.'});current.current.onAccessLost();return true}return false},[])
 const get=useCallback(async(signal:AbortSignal)=>{
  const value=current.current,result=await followUpData<unknown>(await fetch(`/api/follow-ups/${encodeURIComponent(value.id!)}/compose-draft`,{method:'GET',cache:'no-store',headers:{...followUpHeaders(value.context!),[COMPOSE_BINDING_HEADER]:JSON.stringify(value.binding)},signal}),value.context)
  if(result.canWrite!==true)throw new FollowUpClientError('Draft access changed. Reload before continuing.',403,'FORBIDDEN')
  const data=composeDraftSnapshot.parse(result.data);if(data.id!==value.id)throw new Error('The saved draft could not be verified.')
  return data
 },[])
 const read=useCallback(async(reason:'initial'|'check'|'restore'='check')=>{
  if(!valid()||offlineRef.current||current.current.paused)return
  const previous=modelRef.current,localAtStart=serialize(local()),target=previous.snapshot,number=++sequence.current,request=new AbortController()
  controller.current?.abort();controller.current=request;setModel(value=>({...value,mode:reason==='initial'?'loading':'checking',message:''}))
  const active=()=>valid()&&number===sequence.current&&!request.signal.aborted
  try{
   const data=await get(request.signal);if(!active())return
   if(previous.snapshot&&data.sourceVersion!==previous.snapshot.sourceVersion){setModel({...previous,mode:'blocked',message:'The email source changed. Keep your edits and reopen a current draft.'});return}
   if(reason==='restore'){
    if(!target||data.revision!==target.revision||data.outdated||!data.content||serialize(data.content)!==serialize(target.content)||serialize(local())!==localAtStart){setModel({...previous,snapshot:data,mode:'review',message:'Saved or local edits changed during the check. Review again before replacing anything.'});return}
    current.current.onRestore(data.content);pending.current=null;setModel({snapshot:data,mode:'ready',ack:serialize(data.content),message:''});return
   }
   const operation=pending.current
   if(operation&&data.operationId===operation.operationId&&data.revision===operation.expectedRevision+1&&!data.outdated&&serialize(data.content)===serialize(operation.content)){pending.current=null;setModel({snapshot:data,mode:'ready',ack:serialize(operation.content??local()),message:''});return}
   if(operation){setModel({...previous,snapshot:data,mode:'error',message:'The save result is still unconfirmed. Check again before retrying it.'});return}
   const same=Boolean(data.content&&serialize(data.content)===serialize(local()))
   const review=data.outdated||!same&&(reason!=='initial'||Boolean(data.content))
   setModel({snapshot:data,mode:review?'review':'ready',ack:data.content&&serialize(data.content)===serialize(local())?serialize(data.content):initial.current,message:data.outdated?'A saved draft belongs to an older email source and cannot be restored.':''})
  }catch(error){if(!active()||accessError(error))return;setModel(value=>({...value,mode:error instanceof FollowUpClientError&&error.code==='COMPOSE_SOURCE_CHANGED'?'blocked':'error',message:'The saved draft could not be checked. Your current edits are kept.'}))}
 },[valid,get,accessError])
 const save=useCallback(async(content:ComposeDraftContent|null,exact?:ComposeDraftWrite,afterSend=false)=>{
  const before=modelRef.current,value=current.current
  if(!valid()||offlineRef.current||!before.snapshot||value.paused&&!afterSend||['saving','checking','loading','blocked'].includes(before.mode))return
  let operation:ComposeDraftWrite
  try{operation=composeDraftWrite.parse(exact??{operationId:crypto.randomUUID(),expectedRevision:before.snapshot.revision,sourceVersion:before.snapshot.sourceVersion,binding:value.binding,content})}catch{setModel(previous=>({...previous,mode:'error',message:'This draft is too large or has an invalid subject. Your edits are kept.'}));return}
  pending.current=operation
  const number=++sequence.current,request=new AbortController();controller.current?.abort();controller.current=request
  setModel(previous=>({...previous,mode:'saving',message:''}))
  try{
   const result=await followUpData<unknown>(await fetch(`/api/follow-ups/${encodeURIComponent(value.id!)}/compose-draft`,{method:'PUT',cache:'no-store',headers:{...followUpHeaders(value.context!),'content-type':'application/json'},body:JSON.stringify(operation),signal:request.signal}),value.context)
   if(!valid()||number!==sequence.current||request.signal.aborted)return
   const data=composeDraftSnapshot.parse(result.data)
   if(result.canWrite!==true)throw new FollowUpClientError('Draft access changed. Reload before continuing.',403,'FORBIDDEN')
   if(data.id!==value.id||data.operationId!==operation.operationId||data.revision!==operation.expectedRevision+1||data.sourceVersion!==operation.sourceVersion||data.outdated||serialize(data.content)!==serialize(operation.content))throw new Error('Save acknowledgement changed.')
   pending.current=null;setModel({snapshot:data,mode:'ready',ack:serialize(operation.content??local()),message:operation.content===null?'Saved copy cleared. Your current text stays in this tab.':''})
  }catch(error){if(!valid()||number!==sequence.current||request.signal.aborted||accessError(error))return;const known=error instanceof FollowUpClientError&&error.status>=400&&error.status<500;if(known)pending.current=null;setModel(previous=>({...previous,mode:error instanceof FollowUpClientError&&error.code==='COMPOSE_SOURCE_CHANGED'?'blocked':'error',message:known?(error as Error).message:'The save result is unconfirmed. Your newer edits are kept; no save is retried automatically.'}))}
 },[valid,accessError])
 useEffect(()=>{
  live.current=true
  const disconnected=()=>{offlineRef.current=true;setOffline(true);sequence.current++;controller.current?.abort();setModel(value=>({...value,mode:'error',message:'Offline. These edits are not saved.'}))}
  const connected=()=>{offlineRef.current=false;setOffline(false);setModel(value=>({...value,mode:'error',message:'Connection changed. Check the saved draft before saving again.'}))}
  if(enabled){if(!navigator.onLine)disconnected();else if(changed)setModel(value=>({...value,mode:'blocked',message:'The email source changed. Keep your edits and reopen a current draft.'}));else void read('initial')}
  window.addEventListener('offline',disconnected);window.addEventListener('online',connected)
  return()=>{live.current=false;controller.current?.abort();window.removeEventListener('offline',disconnected);window.removeEventListener('online',connected)}
 },[enabled,changed,read])
 const value=serialize({subject:input.subject,body:input.body}),dirty=value!==model.ack
 useEffect(()=>{
  if(!enabled||changed||offline||input.paused||model.mode!=='ready'||!dirty)return
  const timer=window.setTimeout(()=>void save(local()),1000)
  return()=>window.clearTimeout(timer)
 },[enabled,changed,offline,input.paused,model.mode,model.ack,value,dirty,save])
 const blocked=changed||model.mode==='blocked'
 return {enabled,model,offline,blocked,dirty,uncertain:Boolean(pending.current),paused:input.paused,read:()=>void read('check'),restore:()=>void read('restore'),saveCurrent:()=>void save(local()),clear:()=>void save(null),retry:()=>{if(pending.current)void save(pending.current.content,pending.current)},noteSend:(content:ComposeDraftContent)=>{sent.current=serialize(content)},clearAfterSend:()=>{const value=modelRef.current;if(!pending.current&&value.mode==='ready'&&value.snapshot?.content&&serialize(value.snapshot.content)===sent.current&&serialize(local())===sent.current)void save(null,undefined,true)}}
}
export function ComposeDraftRecovery({state}:{state:ReturnType<typeof useComposeDraftRecovery>}){
 if(!state.enabled)return null
 const {model,offline,paused}=state,busy=['loading','saving','checking'].includes(model.mode),disabled=offline||paused||busy||state.blocked
 const saved=model.mode==='ready'&&!state.dirty&&Boolean(model.snapshot?.content)
 const status=offline?'Offline — edits are not saved.':model.mode==='loading'||model.mode==='checking'?'Checking saved draft…':model.mode==='saving'?'Saving draft…':saved?'Saved draft.':'Unsaved draft.'
 return <section aria-label="Draft recovery" className="space-y-2 rounded-md border bg-muted/30 p-3 text-xs">
  <p role="status" className="font-medium">{status}</p>
  {model.message&&<p>{model.message}</p>}
  {model.snapshot?.updatedAt&&<p>Saved copy: <time dateTime={model.snapshot.updatedAt}>{new Date(model.snapshot.updatedAt).toLocaleString()}</time></p>}
  {model.mode==='review'&&<><p>Restoring replaces the current subject and body. Nothing is restored automatically.</p>{model.snapshot?.content&&<p>Saved subject: {model.snapshot.content.subject}</p>}</>}
  <p>Subject and body only; attachments stay in this tab. Restoring does not confirm whether an earlier send succeeded. Check sent mail before sending again.</p>
  <div className="flex flex-wrap gap-2">
   <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={state.read}>Check saved draft</Button>
   {model.mode==='review'&&model.snapshot?.content&&!model.snapshot.outdated&&<Button type="button" variant="outline" size="sm" disabled={disabled} onClick={state.restore}>Restore saved draft</Button>}
   {model.mode==='review'&&<Button type="button" variant="outline" size="sm" disabled={disabled} onClick={state.saveCurrent}>Save current edits instead</Button>}
   {model.mode==='error'&&state.uncertain&&<Button type="button" variant="outline" size="sm" disabled={disabled||!model.snapshot} onClick={state.retry}>Retry same save</Button>}
   {model.snapshot?.content&&model.mode==='ready'&&<Button type="button" variant="outline" size="sm" disabled={disabled} onClick={state.clear}>Clear saved copy</Button>}
  </div>
 </section>
}
