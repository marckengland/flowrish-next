import {z} from 'zod'
import {followUpHeaders,type FollowUpContext} from './follow-up-access'
import {followUpData} from './follow-up-client'
import {MAX_HISTORY_EXPORT_BATCHES,historyExportPageData,followUpHistoryAction,followUpHistoryEntry,type FollowUpHistoryKind} from './follow-up-history'
import type {HistoryDateRange} from './follow-up-history-dates'
export {HISTORY_EXPORT_BATCH_SIZE,MAX_HISTORY_EXPORT_BATCHES,historyExportPageData} from './follow-up-history'
const MAX_BYTES=16*1024*1024
type Entry=z.infer<typeof followUpHistoryEntry>
type Filters={kind:FollowUpHistoryKind;range:HistoryDateRange|null;displayTimeZone:string}
type Input=Filters&{id:string;context:FollowUpContext;signal:AbortSignal;isCurrent:()=>boolean;onProgress:(value:{actions:number;batches:number;checking:boolean})=>void}
const invalid=()=>new Error('The activity export could not be verified. No file was created. Start a fresh export.')
const tooLarge=()=>new Error('This history is too large to export in one file. Narrow the date or action filters. No file was created.')
const aborted=()=>new DOMException('Export cancelled.','AbortError')
const cell=(value:unknown)=>{const text=String(value??''),safe=/^[\s\uFEFF]*[=+\-@]|^[\t\r\n]/.test(text)?"'"+text:text;return '"'+safe.replace(/"/g,'""')+'"'}
export function buildHistoryCsv(entries:readonly Entry[],filters:Filters,startedAt:string,checkedAt:string):string{
 const formatter=new Intl.DateTimeFormat('en-GB',{timeZone:filters.displayTimeZone,calendar:'iso8601',numberingSystem:'latn',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3,hourCycle:'h23'})
 const local=(value:string)=>{const parts=formatter.formatToParts(new Date(value)),part=(key:string)=>parts.find(item=>item.type===key)!.value;return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')}.${part('fractionalSecond')}`}
 const lines:string[]=[],encoder=new TextEncoder();let bytes=3
 const append=(values:unknown[])=>{const line=values.map(cell).join(',')+'\r\n';bytes+=encoder.encode(line).byteLength;if(bytes>MAX_BYTES)throw tooLarge();lines.push(line)}
 append(['Row type','Action ID','Action','Actor','Recorded at (UTC)','Recorded at (display timezone)','Display timezone','Snoozed until (UTC)','Snooze timezone','Action filter','From (inclusive)','To (inclusive)','Filter timezone','UTC window start (inclusive)','UTC window end (exclusive)','Export started at (UTC)','Access checked at (UTC)','Action count'])
 const row=(entry?:Entry)=>[entry?'Action':'Export details',entry?.id??'',entry?followUpHistoryAction(entry.kind):'',entry?.actor??'',entry?new Date(entry.occurredAt).toISOString():'',entry?local(entry.occurredAt):'',filters.displayTimeZone,entry?.until?new Date(entry.until).toISOString():'',entry?.timeZone??'',filters.kind==='all'?'All actions':followUpHistoryAction(filters.kind),filters.range?.from??'All dates',filters.range?.to??'',filters.range?.timeZone??'',filters.range?.start??'',filters.range?.end??'',startedAt,checkedAt,entries.length]
 append(row());for(const entry of entries)append(row(entry));return '\uFEFF'+lines.join('')
}
export async function collectHistoryCsv(input:Input):Promise<{csv:string;count:number;checkedAt:string}>{
 const entries:Entry[]=[],ids=new Set<string>(),tokens=new Set<string>();let first:z.infer<typeof historyExportPageData>|null=null,lastTime=Infinity
 const current=()=>{if(input.signal.aborted||!input.isCurrent())throw aborted()}
 const read=async(page:number,cursor?:string)=>{
  current();const query=new URLSearchParams({page:String(page)});if(input.kind!=='all')query.set('kind',input.kind);if(input.range){query.set('from',input.range.from);query.set('to',input.range.to);query.set('timeZone',input.range.timeZone)}if(cursor)query.set('cursor',cursor)
  const request=new AbortController();let interrupt!:(cause:unknown)=>void
  const interrupted=new Promise<never>((_,reject)=>{interrupt=reject}),cancel=()=>{request.abort();interrupt(aborted())}
  input.signal.addEventListener('abort',cancel,{once:true})
  const timer=setTimeout(()=>{request.abort();interrupt(new Error('The activity export timed out. No file was created. Start a fresh export.'))},30000)
  try{
   const payload=await Promise.race([(async()=>followUpData(await fetch(`/api/follow-ups/${encodeURIComponent(input.id)}/history/export?${query}`,{method:'GET',cache:'no-store',headers:followUpHeaders(input.context),signal:request.signal}),input.context))(),interrupted]);current()
   const parsed=historyExportPageData.safeParse(payload.data);if(!parsed.success)throw invalid();const data=parsed.data
   if(data.id!==input.id||data.kind!==input.kind||data.page!==page||JSON.stringify(data.range)!==JSON.stringify(input.range)||cursor!==undefined&&data.paging.cursor!==cursor||data.hasMore!==(data.paging.nextCursor!==null))throw invalid()
   for(const entry of data.entries)if(input.kind!=='all'&&entry.kind!==input.kind||input.range&&(Date.parse(entry.occurredAt)<Date.parse(input.range.start)||Date.parse(entry.occurredAt)>=Date.parse(input.range.end)))throw invalid()
   return data
  }finally{clearTimeout(timer);input.signal.removeEventListener('abort',cancel);request.abort()}
 }
 try{
  let cursor:string|undefined
  for(let page=1;page<=MAX_HISTORY_EXPORT_BATCHES;page++){
   const data=await read(page,cursor);first??=data
   if(tokens.has(data.paging.cursor))throw invalid();tokens.add(data.paging.cursor)
   for(const entry of data.entries){const time=Date.parse(entry.occurredAt);if(ids.has(entry.id)||time>lastTime)throw invalid();ids.add(entry.id);lastTime=time;entries.push(entry)}
   input.onProgress({actions:entries.length,batches:page,checking:false});current()
   if(data.paging.nextCursor){if(tokens.has(data.paging.nextCursor))throw invalid();cursor=data.paging.nextCursor;if(page===MAX_HISTORY_EXPORT_BATCHES)throw tooLarge();continue}
   const csv=buildHistoryCsv(entries,input,first.current.checkedAt,data.current.checkedAt);current();input.onProgress({actions:entries.length,batches:page,checking:true})
   const final=await read(1,first.paging.cursor);if(JSON.stringify(final.entries)!==JSON.stringify(first.entries)||final.paging.nextCursor!==first.paging.nextCursor)throw new Error('The history changed before the export could be verified. No file was created. Start a fresh export.')
   current();return {csv:final.current.checkedAt===data.current.checkedAt?csv:buildHistoryCsv(entries,input,first.current.checkedAt,final.current.checkedAt),count:entries.length,checkedAt:final.current.checkedAt}
  }
  throw tooLarge()
 }finally{entries.length=0;ids.clear();tokens.clear();first=null}
}
