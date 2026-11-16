'use client'
import {useEffect,useRef,useState} from 'react'
import {Button} from '@/components/ui/button'
import {collectHistoryCsv} from '@/lib/follow-up-history-export'
import {followUpAccessLost} from '@/lib/follow-up-client'
import type {FollowUpContext} from '@/lib/follow-up-access'
import type {FollowUpHistoryKind} from '@/lib/follow-up-history'
import type {HistoryDateRange} from '@/lib/follow-up-history-dates'
type Props={id:string;context:FollowUpContext;kind:FollowUpHistoryKind;range:HistoryDateRange|null;displayTimeZone:string;revision:string;disabled:boolean;onAccessLost:(cause:unknown,id:string)=>void}
const identity=(p:Props)=>JSON.stringify([p.context.organizationId,p.context.userId,p.id,p.kind,p.range,p.displayTimeZone,p.revision,p.disabled])
export function FollowUpHistoryExport(props:Props){return <Export key={JSON.stringify([props.context.organizationId,props.context.userId,props.id])} {...props}/>}
function Export(props:Props){
 const [busy,setBusy]=useState(false),[progress,setProgress]=useState({actions:0,batches:0,checking:false}),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const latest=useRef(props),live=useRef(true),running=useRef(false),controller=useRef<AbortController|null>(null),region=useRef<HTMLElement|null>(null),blocked=useRef(false),previous=useRef(identity(props));latest.current=props
 const view=identity(props)
 useEffect(()=>{live.current=true;return()=>{live.current=false;controller.current?.abort();controller.current=null;running.current=false}},[])
 useEffect(()=>{if(previous.current===view)return;previous.current=view;if(!running.current)return;controller.current?.abort();controller.current=null;running.current=false;setBusy(false);setError('');setNotice('The history view changed. Export cancelled; no file was created.')},[view])
 function cancel(){controller.current?.abort();controller.current=null;running.current=false;setBusy(false);setError('');setNotice('Export cancelled. No file was created.')}
 async function start(){
  const captured=latest.current;if(running.current||blocked.current||captured.disabled||!captured.displayTimeZone||!region.current?.isConnected)return
  const request=new AbortController(),key=identity(captured);controller.current=request;running.current=true;setBusy(true);setError('');setNotice('');setProgress({actions:0,batches:0,checking:false})
  const active=()=>live.current&&controller.current===request&&!request.signal.aborted&&!latest.current.disabled&&identity(latest.current)===key&&Boolean(region.current?.isConnected)
  try{
   const result=await collectHistoryCsv({id:captured.id,context:captured.context,kind:captured.kind,range:captured.range,displayTimeZone:captured.displayTimeZone,signal:request.signal,isCurrent:active,onProgress:value=>{if(active())setProgress(value)}})
   if(!active())return
   const url=URL.createObjectURL(new Blob([result.csv],{type:'text/csv;charset=utf-8'})),link=document.createElement('a')
   try{if(!active())return;link.href=url;link.download=`follow-up-activity-${result.checkedAt.slice(0,10)}.csv`;link.rel='noopener';document.body.appendChild(link);if(!active())return;link.click();setNotice(`CSV download started · ${result.count} ${result.count===1?'action':'actions'}.`)}finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),0)}
  }catch(cause){
   if(!active())return
   if(followUpAccessLost(cause)){blocked.current=true;setError('Access changed. Reload before exporting. No file was created.');latest.current.onAccessLost(cause,captured.id);return}
   const message=cause instanceof Error?cause.message:'The export could not be completed.';setError(message.includes('No file was created.')?message:message+(/[.!?]$/.test(message)?' ':'. ')+'No file was created.')
  }finally{if(controller.current===request){controller.current=null;running.current=false;if(live.current)setBusy(false)}}
 }
 return <section ref={region} aria-label="Activity CSV export" aria-busy={busy} className="space-y-2 rounded-md border p-2">
  <div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" disabled={busy||props.disabled||blocked.current||!props.displayTimeZone} onClick={()=>void start()}>Export activity CSV</Button>{busy&&<Button type="button" variant="outline" onClick={cancel}>Cancel export</Button>}</div>
  <p className="text-xs text-muted-foreground">Exports all matching recorded actions using the applied filters. Your page and edits stay open. Up to 20,000 scanned records per file; narrow the filters for larger histories.</p>
  {busy&&<p role="status" className="text-sm">{progress.checking?'Rechecking export access…':`Exporting ${progress.actions} actions…`}</p>}{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}{notice&&<p role="status" className="text-sm">{notice}</p>}
 </section>
}
