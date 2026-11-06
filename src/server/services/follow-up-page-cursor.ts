import 'server-only'
import {createHash} from 'node:crypto'
import {z} from 'zod'
import type {LeadAccessFilter} from './access'
import type {FollowUpFilters} from '@/lib/follow-up-filters'
import {AppError} from '@/lib/errors'
type Scope={organizationId:string;userId:string;status:string;filters:FollowUpFilters;taskProgress?:boolean}
const cursor=z.object({v:z.literal(1),binding:z.string().regex(/^[a-f0-9]{64}$/),id:z.string().uuid(),createdAt:z.string().datetime()}).strict()
const deadlineCursor=cursor.extend({v:z.literal(2),dueDate:z.string().datetime().nullable(),orderVersion:z.string().regex(/^[a-f0-9]{64}$/)})
const binding=(scope:Scope)=>createHash('sha256').update(JSON.stringify([scope.organizationId,scope.userId,scope.status,scope.filters.search,scope.filters.source,scope.filters.dueOnly,...(scope.taskProgress||scope.filters.taskProgress?['task-progress',Boolean(scope.taskProgress),scope.filters.taskProgress??null]:[]),...(scope.filters.taskOrder?['task-order',scope.filters.taskOrder]:[])])).digest('hex')
/** Position only: independent list authorization is required on every request. */
export function encodeFollowUpCursor(scope:Scope,anchor:{id:string;createdAt:Date;dueDate?:Date|null;orderVersion?:string}) {
  return Buffer.from(JSON.stringify(scope.filters.taskOrder ? deadlineCursor.parse({v:2,binding:binding(scope),id:anchor.id,createdAt:anchor.createdAt.toISOString(),dueDate:anchor.dueDate?.toISOString()??null,orderVersion:anchor.orderVersion}) : cursor.parse({v:1,binding:binding(scope),id:anchor.id,createdAt:anchor.createdAt.toISOString()}))).toString('base64url')
}
export function decodeFollowUpCursor(scope:Scope,raw:string) {
  let value:z.infer<typeof cursor>|z.infer<typeof deadlineCursor>
  try {z.string().min(1).max(1024).regex(/^[A-Za-z0-9_-]+$/).parse(raw);value=z.union([cursor,deadlineCursor]).parse(JSON.parse(Buffer.from(raw,'base64url').toString('utf8')))}
  catch {throw new AppError('VALIDATION_ERROR','Send a valid follow-up page cursor.',400)}
  if(value.binding!==binding(scope)||Boolean(scope.filters.taskOrder)!==(value.v===2))throw new AppError('FOLLOW_UP_PAGE_CHANGED','The account, business or filters changed. Refresh before loading more.',409)
  return {id:value.id,createdAt:new Date(value.createdAt),...(value.v===2?{dueDate:value.dueDate===null?null:new Date(value.dueDate),orderVersion:value.orderVersion}:{})}
}

export function followUpPageAccessVersion(filter:LeadAccessFilter,taskScope?:{assigneeId?:string}) {
  const assigned=filter.assignedUserId
  const normalized={...filter,...(assigned&&typeof assigned==='object'?{assignedUserId:{in:[...new Set(assigned.in)].sort()}}:{})}
  return createHash('sha256').update(JSON.stringify(taskScope?{lead:normalized,task:taskScope}:normalized)).digest('hex')
}
