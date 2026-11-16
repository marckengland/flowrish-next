import 'server-only'
import {createHash} from 'node:crypto'
import {z} from 'zod'
import {AppError} from '@/lib/errors'
import {historyCursorToken,type FollowUpHistoryKind} from '@/lib/follow-up-history'
import {HISTORY_EXPORT_BATCH_SIZE} from '@/lib/follow-up-history'
import type {HistoryDateRange} from '@/lib/follow-up-history-dates'
type Scope={organizationId:string;userId:string;id:string;kind:FollowUpHistoryKind;range?:HistoryDateRange|null;exporting?:boolean}
type Anchor={id:string;createdAt:Date}
type Position={page:number;through:Anchor|null;after:Anchor|null}
const anchor=z.object({id:z.string().uuid(),createdAt:z.string().datetime()}).strict()
const cursor=z.object({v:z.literal(1),binding:z.string().regex(/^[a-f0-9]{64}$/),page:z.number().int().min(1).max(10000),through:anchor.nullable(),after:anchor.nullable()}).strict().refine(value=>{
 if(!value.through)return value.page===1&&value.after===null
 if(value.page===1)return value.after===null
 return value.after!==null&&(value.after.createdAt<value.through.createdAt||value.after.createdAt===value.through.createdAt&&value.after.id<=value.through.id)
})
const binding=(scope:Scope)=>createHash('sha256').update(JSON.stringify([scope.organizationId,scope.userId,scope.id,scope.kind,...(scope.range?['dates',scope.range.from,scope.range.to,scope.range.timeZone,scope.range.start,scope.range.end]:[]),...(scope.exporting?['csv',1,HISTORY_EXPORT_BATCH_SIZE]:[])])).digest('hex')
const serialize=(value:Anchor|null)=>value?{id:value.id,createdAt:value.createdAt.toISOString()}:null
/** Position only. Every request still requires fresh follow-up authorization. */
export function encodeHistoryCursor(scope:Scope,position:Position){return Buffer.from(JSON.stringify(cursor.parse({v:1,binding:binding(scope),page:position.page,through:serialize(position.through),after:serialize(position.after)}))).toString('base64url')}
export function decodeHistoryCursor(scope:Scope,raw:string,page:number):Position{
 let value:z.infer<typeof cursor>
 try{historyCursorToken.parse(raw);value=cursor.parse(JSON.parse(Buffer.from(raw,'base64url').toString('utf8')))}catch{throw new AppError('VALIDATION_ERROR','Send a valid history position. Refresh activity to start again.',400)}
 if(value.binding!==binding(scope)||value.page!==page)throw new AppError('HISTORY_PAGE_CHANGED','The history filter or position changed. Refresh activity to start again.',409)
 const date=(item:z.infer<typeof anchor>|null)=>item?{id:item.id,createdAt:new Date(item.createdAt)}:null
 return {page:value.page,through:date(value.through),after:date(value.after)}
}
