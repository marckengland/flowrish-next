'use client'
import {z} from 'zod'
import {resolveLocalMinute} from './callback-time'
import {snoozeMetadata} from './follow-up-snooze'
import {followUpHeaders,type FollowUpContext} from './follow-up-access'
import {followUpData,followUpAccessLost,FollowUpClientError} from './follow-up-client'
export const BULK_SNOOZE_LIMIT=20
const target=z.object({id:z.string().min(1).max(128),expectedVersion:z.string().regex(/^[a-f0-9]{64}$/)}).strict()
const targets=z.array(target).min(1).max(BULK_SNOOZE_LIMIT).refine(rows=>new Set(rows.map(row=>row.id)).size===rows.length,'Select each follow-up once.')
const planSchema=z.object({targets,localTime:z.string(),timeZone:z.string().min(1).max(100),until:z.string().datetime()}).strict()
const receiptSchema=z.object({id:z.string().min(1).max(128),snoozeVersion:z.string().regex(/^[a-f0-9]{64}$/),snooze:snoozeMetadata.nullable()})
export type BulkSnoozePlan=z.infer<typeof planSchema>
export type BulkSnoozeReceipt=z.infer<typeof receiptSchema>
export type BulkSnoozeOutcome={id:string;state:'saved'|'verified'|'failed'|'unconfirmed'|'not-attempted'|'not-set';message:string}
type Hooks={active:()=>boolean;onChanged:(row:BulkSnoozeReceipt)=>void;onAccessLost?:(cause:unknown,id:string)=>void;isCurrent?:(row:z.infer<typeof target>)=>boolean;onProgress?:(rows:BulkSnoozeOutcome[])=>void;signal?:AbortSignal}
export function makeBulkSnoozePlan(rows:unknown,localTime:string,timeZone:string,now=new Date()):BulkSnoozePlan {
  const parsed=targets.parse(rows),at=resolveLocalMinute(localTime,timeZone)
  if(at<=now.getTime()||at>now.getTime()+365*86400000)throw new Error('Choose a future reminder within the next 365 days.')
  return planSchema.parse({targets:parsed,localTime,timeZone,until:new Date(at).toISOString()})
}
async function requestReceipt(id:string,context:FollowUpContext,method:'GET'|'POST',body:unknown,signal?:AbortSignal) {
  const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(abort,25000)
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true})
  try {
    const response=await fetch(`/api/follow-ups/${encodeURIComponent(id)}/snooze`,{method,cache:'no-store',headers:{...followUpHeaders(context),...(method==='POST'?{'Content-Type':'application/json'}:{})},...(method==='POST'?{body:JSON.stringify(body)}:{}),signal:controller.signal})
    const value=await followUpData(response,context)
    if(value.canWrite!==true)throw new FollowUpClientError('Editing access changed. Reload before continuing.',403,'FORBIDDEN')
    const result=receiptSchema.parse(value.data)
    if(result.id!==id)throw new Error('The reminder response could not be confirmed.')
    return result
  } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort)}
}
const matches=(row:BulkSnoozeReceipt,plan:BulkSnoozePlan)=>row.snooze?.until===plan.until&&row.snooze.timeZone===plan.timeZone
function failed(cause:unknown,id:string,hooks:Hooks):BulkSnoozeOutcome {
  if(followUpAccessLost(cause))hooks.onAccessLost?.(cause,id)
  const definite=cause instanceof FollowUpClientError&&cause.status>=400&&cause.status<500
  return {id,state:definite?'failed':'unconfirmed',message:definite?(cause.message||'This follow-up changed. Review again.'):'Save could not be confirmed. Check results before trying again.'}
}
export async function runBulkSnooze(raw:BulkSnoozePlan,context:FollowUpContext,hooks:Hooks) {
  const plan=planSchema.parse(raw),checked=makeBulkSnoozePlan(plan.targets,plan.localTime,plan.timeZone)
  if(checked.until!==plan.until)throw new Error('Reminder details changed. Review again.')
  const results:BulkSnoozeOutcome[]=plan.targets.map(row=>({id:row.id,state:'not-attempted',message:'Not attempted.'}))
  for(const [index,row]of plan.targets.entries()) {
    if(!hooks.active())break
    if(hooks.isCurrent&&!hooks.isCurrent(row)){results[index]={id:row.id,state:'failed',message:'This selection changed. Review again before applying.'};hooks.onProgress?.([...results]);break}
    try {
      const result=await requestReceipt(row.id,context,'POST',{action:'snooze',expectedVersion:row.expectedVersion,localTime:plan.localTime,timeZone:plan.timeZone},hooks.signal)
      if(!hooks.active())break
      if(!matches(result,plan)||result.snoozeVersion===row.expectedVersion)throw new Error('Unexpected reminder receipt.')
      hooks.onChanged(result);results[index]={id:row.id,state:'saved',message:'Reminder saved.'}
    } catch(cause) {if(!hooks.active())break;results[index]=failed(cause,row.id,hooks);if(hooks.active())hooks.onProgress?.([...results]);break}
    if(hooks.active())hooks.onProgress?.([...results])
  }
  return results
}
export async function verifyBulkSnooze(raw:BulkSnoozePlan,previous:BulkSnoozeOutcome[],context:FollowUpContext,hooks:Hooks) {
  const plan=planSchema.parse(raw),results=previous.map(row=>({...row})),allowed=new Set(plan.targets.map(row=>row.id))
  if(results.length!==plan.targets.length||new Set(results.map(row=>row.id)).size!==results.length||results.some(row=>!allowed.has(row.id)))throw new Error('The reviewed batch changed.')
  for(const [index,row]of results.entries()) {
    if(!hooks.active())break
    if(!['unconfirmed','failed'].includes(row.state))continue
    try {
      const current=await requestReceipt(row.id,context,'GET',undefined,hooks.signal)
      if(!hooks.active())break
      hooks.onChanged(current);results[index]={id:row.id,state:matches(current,plan)?'verified':'not-set',message:matches(current,plan)?'Requested reminder verified.':'Requested reminder is not currently set. Review before another attempt.'}
    }catch(cause){if(!hooks.active())break;results[index]=failed(cause,row.id,hooks);if(hooks.active())hooks.onProgress?.([...results]);break}
    if(hooks.active())hooks.onProgress?.([...results])
  }
  return results
}
