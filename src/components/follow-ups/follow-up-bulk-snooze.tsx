'use client'
import {useEffect,useId,useRef,useState} from 'react'
import {Button} from '@/components/ui/button'
import {tomorrowLocal,type SnoozeMetadata} from '@/lib/follow-up-snooze'
import {BULK_SNOOZE_LIMIT,makeBulkSnoozePlan,runBulkSnooze,verifyBulkSnooze,type BulkSnoozeOutcome,type BulkSnoozePlan,type BulkSnoozeReceipt} from '@/lib/follow-up-bulk-snooze'
import type {FollowUpContext} from '@/lib/follow-up-access'
import {EMAIL_NOTIFICATION_EVENT} from '@/lib/email-notifications'
type Item={id:string;status:string;snoozeVersion?:string;snooze?:SnoozeMetadata|null;title:string;lead:{firstName:string;lastName:string}}
export const canBulkSnooze=(row:Item)=>row.status==='PENDING'&&Boolean(row.snoozeVersion&&/^[a-f0-9]{64}$/.test(row.snoozeVersion))
type Props={items:Item[];selectedIds:string[];onSelectionChange:(ids:string[])=>void;context:FollowUpContext;disabled:boolean;onChanged:(row:BulkSnoozeReceipt)=>void;onVerified:(row:BulkSnoozeReceipt)=>void;onRefresh:()=>void;refreshing:boolean;onAccessLost:(cause:unknown,id:string)=>void;onBusyChange:(busy:boolean)=>void}
export function FollowUpBulkSnooze(props:Props){
  const zoneDescription=useId()
  const [localTime,setLocalTime]=useState(''),[zone,setZone]=useState(''),[plan,setPlan]=useState<BulkSnoozePlan|null>(null),[results,setResults]=useState<BulkSnoozeOutcome[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const live=useRef(true),writing=useRef(false),generation=useRef(0),controller=useRef<AbortController|null>(null),latest=useRef(props)
  latest.current=props
  const selectionKey=JSON.stringify(props.selectedIds),byId=new Map(props.items.map(row=>[row.id,row]))
  useEffect(()=>{const life=live,counter=generation,pending=controller,currentProps=latest;life.current=true;setZone(Intl.DateTimeFormat().resolvedOptions().timeZone);return()=>{life.current=false;counter.current++;pending.current?.abort();currentProps.current.onBusyChange(false)}},[])
  useEffect(()=>{if(!writing.current){setPlan(null);setResults([]);setError('')}},[selectionKey])
  const stale=Boolean(plan?.targets.some(row=>{const current=byId.get(row.id);return !current||!canBulkSnooze(current)||current.snoozeVersion!==row.expectedVersion}))
  function review(){
    if(props.disabled||props.refreshing||writing.current)return
    try {const rows=props.selectedIds.map(id=>{const row=byId.get(id);if(!row||!canBulkSnooze(row))throw new Error('The loaded selection changed. Select it again.');return{id,expectedVersion:row.snoozeVersion!}});setPlan(makeBulkSnoozePlan(rows,localTime,zone));setResults([]);setError('')}
    catch(cause){setPlan(null);setError(cause instanceof Error?cause.message:'Choose valid reminder details.')}
  }
  async function apply(check=false){
    if(!plan||props.disabled||props.refreshing||writing.current||(!check&&stale))return
    writing.current=true;setBusy(true);props.onBusyChange(true);setError('')
    const request=new AbortController(),current=++generation.current,scope=JSON.stringify(props.context);controller.current=request
    const active=()=>live.current&&current===generation.current&&!request.signal.aborted&&!latest.current.disabled&&JSON.stringify(latest.current.context)===scope
    const hooks={active,signal:request.signal,onChanged:(row:BulkSnoozeReceipt)=>{if(active()){if(check)latest.current.onVerified(row);else latest.current.onChanged(row)}},onAccessLost:(cause:unknown,id:string)=>{if(active())latest.current.onAccessLost(cause,id)},onProgress:(rows:BulkSnoozeOutcome[])=>{if(active())setResults(rows)},isCurrent:(row:{id:string;expectedVersion:string})=>{const value=latest.current.items.find(item=>item.id===row.id);return latest.current.selectedIds.includes(row.id)&&Boolean(value&&canBulkSnooze(value)&&value.snoozeVersion===row.expectedVersion)}}
    try {if(!check)setResults(plan.targets.map(row=>({id:row.id,state:'not-attempted',message:'Not attempted.'})));const next=check?await verifyBulkSnooze(plan,results,props.context,hooks):await runBulkSnooze(plan,props.context,hooks);if(active()){setResults(next);window.dispatchEvent(new Event(EMAIL_NOTIFICATION_EVENT))}}
    catch(cause){if(active())setError(cause instanceof Error?cause.message:'This batch could not be confirmed. Check current reminders.')}
    finally {if(live.current&&current===generation.current){writing.current=false;setBusy(false);latest.current.onBusyChange(false);controller.current=null}}
  }
  const saved=results.filter(row=>row.state==='saved'||row.state==='verified').length,checking=results.some(row=>row.state==='unconfirmed'||row.state==='failed')
  return <section aria-label="Bulk snooze" aria-busy={busy} className="space-y-3 rounded-lg border bg-card p-4">
    <h2 className="text-sm font-medium">Bulk snooze</h2>
    <p className="text-sm">{props.selectedIds.length} selected · up to {BULK_SNOOZE_LIMIT} loaded follow-ups</p>
    <p className="text-xs text-muted-foreground">Only loaded follow-ups awaiting review can be selected. Selected items stay visible until cleared. Open email drafts and their edits stay available; task due dates and callback deadlines stay the same.</p>
    <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy||props.refreshing||props.disabled} onClick={()=>props.onSelectionChange(props.items.filter(canBulkSnooze).slice(0,BULK_SNOOZE_LIMIT).map(row=>row.id))}>Select up to 20 loaded</Button><Button type="button" variant="outline" disabled={busy||props.refreshing||props.disabled||!props.selectedIds.length} onClick={()=>props.onSelectionChange([])}>Clear selection</Button><Button type="button" variant="outline" disabled={busy||props.refreshing||props.disabled} onClick={props.onRefresh}>Refresh loaded follow-ups</Button></div>
    <div className="flex flex-wrap items-end gap-2"><label className="grid gap-1 text-sm">Bulk reminder time<input type="datetime-local" aria-label="Bulk reminder time" aria-describedby={zoneDescription} className="min-h-11 max-w-full rounded-md border bg-background px-3 py-2" value={localTime} disabled={busy||props.refreshing||props.disabled} onChange={event=>{setLocalTime(event.target.value);setPlan(null);setResults([])}}/><span id={zoneDescription} className="text-xs text-muted-foreground">{zone||'Detecting timezone…'}</span></label><Button type="button" variant="outline" disabled={busy||props.refreshing||props.disabled||!zone} onClick={()=>{setLocalTime(tomorrowLocal());setPlan(null);setResults([])}}>Tomorrow at 9:00</Button><Button type="button" disabled={busy||props.refreshing||props.disabled||!zone||!localTime||!props.selectedIds.length||results.length>0} onClick={review}>Review bulk snooze</Button></div>
    {plan&&results.length===0&&<div role="group" aria-label="Bulk snooze review" className="space-y-3 rounded-lg border p-3"><p className="text-sm">Snooze {plan.targets.length} selected follow-ups until <time dateTime={plan.until}>{new Date(plan.until).toLocaleString(undefined,{timeZone:plan.timeZone})}</time> ({plan.timeZone}).</p><ul className="space-y-1 text-sm">{plan.targets.map(row=>{const item=byId.get(row.id);return <li key={row.id} className="break-words">{item?`${item.lead.firstName} ${item.lead.lastName}: ${item.title}`:'Unavailable follow-up'}</li>})}</ul><p className="text-xs text-muted-foreground">Each item is saved separately. Processing stops on the first failure; drafts remain open.</p>{stale&&<p role="alert" className="text-sm text-destructive">Selected follow-ups changed. Review again before applying.</p>}<Button type="button" disabled={busy||props.refreshing||props.disabled||stale} onClick={()=>void apply()}>Confirm bulk snooze</Button></div>}
    {busy&&<p role="status" className="text-sm">Checking or saving selected reminders…</p>}
    {results.length>0&&<div className="space-y-2"><p role="status" className="text-sm">{saved} of {results.length} reminders saved or verified.</p><ul className="space-y-1 text-sm">{results.map(row=>{const item=byId.get(row.id);return <li key={row.id} className="break-words">{item?`${item.lead.firstName} ${item.lead.lastName}: ${item.title}`:'Unavailable follow-up'} — <span>{row.message}</span></li>})}</ul>{checking&&<><p className="text-xs text-muted-foreground">Check results reads current reminders and does not repeat a save. Refresh loaded follow-ups for current details, then clear the selection and review before a new attempt.</p><Button type="button" variant="outline" disabled={busy||props.refreshing||props.disabled} onClick={()=>void apply(true)}>Check results</Button></>}</div>}
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>
}
