import {z} from 'zod'
import {resolveLocalMinute} from './callback-time'
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/,'Choose real dates from 2000 to 2100.').refine(value=>value>='2000-01-01'&&value<='2100-12-31'&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value,'Choose real dates from 2000 to 2100.')
const zone=z.string().min(1).max(100).refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value}).format(0);return true}catch{return false}},'Choose a valid timezone.')
const input=z.object({from:day,to:day,timeZone:zone}).strict().refine(value=>value.from<=value.to,'End date must be on or after the start date.')
export const historyDateRange=z.object({from:day,to:day,timeZone:zone,start:z.string().datetime(),end:z.string().datetime()}).strict()
export type HistoryDateRange=z.infer<typeof historyDateRange>
const shift=(value:string,days:number)=>new Date(Date.parse(value+'T00:00:00Z')+days*86400000).toISOString().slice(0,10)
/** Inclusive calendar dates, represented by a half-open UTC interval. */
export function resolveHistoryDateRange(raw:unknown):HistoryDateRange{
 const parsed=input.safeParse(raw)
 if(!parsed.success)throw new RangeError(parsed.error.issues.some(issue=>issue.path[0]==='from'||issue.path[0]==='to')?'Choose real dates from 2000 to 2100.':parsed.error.issues[0]?.message??'Choose real dates from 2000 to 2100.')
 const value=parsed.data
 try{return {...value,start:new Date(resolveLocalMinute(value.from+'T00:00',value.timeZone)).toISOString(),end:new Date(resolveLocalMinute(shift(value.to,1)+'T00:00',value.timeZone)).toISOString()}}
 catch{throw new RangeError('This range has an unavailable or ambiguous midnight in the shown timezone. Choose different boundary dates.')}
}
export function historyPresetRange(days:7|30,timeZone:string,now=new Date(Date.now())):HistoryDateRange{
 const formatter=new Intl.DateTimeFormat('en-GB',{timeZone,calendar:'iso8601',numberingSystem:'latn',year:'numeric',month:'2-digit',day:'2-digit'}),parts=formatter.formatToParts(now),part=(key:string)=>parts.find(value=>value.type===key)!.value,to=`${part('year')}-${part('month')}-${part('day')}`
 return resolveHistoryDateRange({from:shift(to,1-days),to,timeZone})
}
