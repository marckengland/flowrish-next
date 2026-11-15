'use client'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { followUpHeaders, type FollowUpContext } from '@/lib/follow-up-access'
import { followUpAccessLost, followUpData } from '@/lib/follow-up-client'
import { FOLLOW_UP_HISTORY_PAGE_HEADER, followUpHistoryAction, followUpHistoryData, type FollowUpHistoryData, type FollowUpHistoryKind } from '@/lib/follow-up-history'
type Props = { id:string; context:FollowUpContext; revision:string; onAccessLost:(cause:unknown,id:string)=>void }
function dateLabel(value:string,timeZone?:string|null) { try { return new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short',...(timeZone?{timeZone}:{})}).format(new Date(value)) } catch { return value } }
export function FollowUpHistory(props:Props) { return <History key={`${props.context.organizationId}:${props.context.userId}:${props.id}`} {...props} /> }
function History({id,context,revision,onAccessLost}:Props) {
  const {organizationId,userId}=context, regionId=useId()
  const [open,setOpen]=useState(false),[data,setData]=useState<FollowUpHistoryData|null>(null),[page,setPage]=useState(1),[busy,setBusy]=useState(false),[error,setError]=useState(''),[kind,setKind]=useState<FollowUpHistoryKind>('all')
  const live=useRef(true),controller=useRef<AbortController|null>(null),blocked=useRef(false)
  const positions=useRef(new Map<number,string>()),currentPage=useRef(1),lastAttempt=useRef(1)
  const reset=()=>{positions.current.clear();currentPage.current=1;setPage(1)}
  const cancel=useCallback(()=>{controller.current?.abort();controller.current=null},[])
  const load=useCallback(async(nextPage:number,restart=false)=>{
    if (!live.current || blocked.current) return
    if(restart){positions.current.clear();currentPage.current=1;setPage(1)}
    const cursor=positions.current.get(nextPage);currentPage.current=nextPage;lastAttempt.current=nextPage
    cancel();const request=new AbortController();controller.current=request;setBusy(true);setData(null);setError('')
    const active=()=>live.current&&!request.signal.aborted&&controller.current===request
    try {
      if(nextPage>1&&!cursor)throw new Error('Unexpected activity response. Refresh to try again.')
      const captured={organizationId,userId}, response=await fetch(`/api/follow-ups/${id}/history?page=${nextPage}${kind==='all'?'':`&kind=${kind}`}${cursor?`&cursor=${cursor}`:''}`,{method:'GET',cache:'no-store',headers:{...followUpHeaders(captured),[FOLLOW_UP_HISTORY_PAGE_HEADER]:'1'},signal:request.signal})
      const result=followUpHistoryData.parse((await followUpData(response,captured)).data)
      if (!result.paging || cursor!==undefined&&result.paging.cursor!==cursor || Boolean(result.paging?.nextCursor)!==result.hasMore || result.id!==id || result.page!==nextPage || result.kind!==kind || (kind!=='all'&&result.entries.some(entry=>entry.kind!==kind)) || new Set(result.entries.map(entry=>entry.id)).size!==result.entries.length) throw new Error('Unexpected activity response. Refresh to try again.')
      if (active()) {positions.current.set(nextPage,result.paging.cursor);for(const key of positions.current.keys())if(key>nextPage)positions.current.delete(key);if(result.paging.nextCursor)positions.current.set(nextPage+1,result.paging.nextCursor);setData(result);setPage(nextPage)}
    } catch(cause) {
      if (!active()) return
      if (followUpAccessLost(cause)) {blocked.current=true;setData(null);onAccessLost(cause,id);return}
      setError(cause instanceof Error?cause.message:'Activity is unavailable. Refresh to try again.')
    } finally {if (active()) {controller.current=null;setBusy(false)}}
  },[cancel,id,organizationId,userId,onAccessLost,kind])
  useEffect(()=>{live.current=true;return()=>{live.current=false;cancel()}},[cancel])
  useEffect(()=>{if(open) void load(currentPage.current);return cancel},[open,revision,load,cancel])
  useEffect(()=>{
    if (!open || error) return
    const refresh=()=>{if(document.visibilityState==='visible'&&!controller.current) void load(page)}
    const timer=window.setInterval(refresh,60000);window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh)
    return()=>{window.clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh)}
  },[open,page,load,error])
  const explanation=data?{pending:'Pending your review.',snoozed:'Hidden from Pending until your snooze time.',due:'Returned to Pending because your snooze time elapsed. This does not approve work or send email.',approved:'This follow-up was approved.',dismissed:'This follow-up was dismissed.'}[data.current.state]:''
  return <div className="mt-4">
    <Button type="button" variant="outline" aria-expanded={open} aria-controls={regionId} onClick={()=>{cancel();setData(null);setError('');setBusy(false);reset();setOpen(value=>!value)}}>{open?'Hide activity':'View activity'}</Button>
    {open&&<section id={regionId} aria-label="Follow-up activity" aria-busy={busy} className="mt-3 space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Your follow-up activity</h3><Button type="button" variant="outline" disabled={busy||blocked.current} onClick={()=>void load(1,true)}>Refresh activity</Button></div>
      <p className="text-xs text-muted-foreground">Your saved review, restore and snooze actions, newest first. Other users’ personal snoozes and unsupported legacy records are not shown. Refresh activity loads newer actions. Older and Newer keep your current history view. Viewing activity does not change work.</p>
      <label className="flex flex-wrap items-center gap-2 text-sm">Activity action<select className="min-w-0 rounded-md border bg-background p-2" value={kind} disabled={blocked.current} onChange={event=>{cancel();setData(null);setError('');reset();setKind(event.target.value as FollowUpHistoryKind)}}><option value="all">All actions</option><option value="approved">Approved</option><option value="dismissed">Dismissed</option><option value="snoozed">Snoozed</option><option value="woke">Woke</option><option value="restored">Restored</option></select></label>
      {busy&&<p role="status" className="text-sm">Loading activity…</p>}{error&&<div><p role="alert" className="text-sm text-destructive">{error}</p><Button type="button" variant="outline" disabled={busy||blocked.current} onClick={()=>void load(lastAttempt.current)}>Retry activity</Button></div>}
      {data&&<><div className="space-y-1 text-sm"><p>{explanation}</p>{data.current.until&&<p>Snooze time: <time dateTime={data.current.until}>{dateLabel(data.current.until,data.current.timeZone)}</time> · {data.current.timeZone}</p>}<p className="text-xs text-muted-foreground">Checked <time dateTime={data.current.checkedAt}>{dateLabel(data.current.checkedAt)}</time></p></div>
        {data.entries.length?<ol aria-label="Recorded actions" className="divide-y">{data.entries.map(entry=><li key={entry.id} className="space-y-1 py-3 text-sm"><p><span className="font-medium">{entry.actor}</span> · <span>{followUpHistoryAction(entry.kind)}</span></p><time dateTime={entry.occurredAt} className="block text-xs text-muted-foreground">{dateLabel(entry.occurredAt)}</time>{entry.until&&<p className="break-words text-xs">Until <time dateTime={entry.until}>{dateLabel(entry.until,entry.timeZone)}</time> · {entry.timeZone}</p>}</li>)}</ol>:<p className="text-sm text-muted-foreground">No recorded actions on this page.</p>}
        <div className="flex flex-wrap items-center gap-2"><p className="text-xs text-muted-foreground">Activity · Page {data.page}</p><Button type="button" variant="outline" disabled={busy||page===1} onClick={()=>void load(page-1)}>Newer activity</Button><Button type="button" variant="outline" disabled={busy||!data.hasMore||page>=10000} onClick={()=>void load(page+1)}>Older activity</Button></div>
      </>}
    </section>}
  </div>
}
