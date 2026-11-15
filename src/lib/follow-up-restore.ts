import {z} from 'zod'
const id=z.string().min(1).max(128),hash=z.string().regex(/^[a-f0-9]{64}$/)
export const followUpRestoreInput=z.object({requestId:z.string().uuid(),expectedVersion:hash}).strict()
export const followUpRestorePreview=z.object({id,version:hash,leadName:z.string(),title:z.string(),task:z.object({id,title:z.string()}).strict().nullable(),clearsSnooze:z.boolean()}).strict()
export const followUpRestoreReceipt=z.discriminatedUnion('state',[
 z.object({id,requestId:z.string().uuid(),state:z.literal('confirmed'),taskId:id.nullable(),restoredAt:z.string().datetime()}).strict(),
 z.object({id,requestId:z.string().uuid(),state:z.enum(['changed','not-recorded'])}).strict(),
])
export type FollowUpRestoreInput=z.infer<typeof followUpRestoreInput>
export type FollowUpRestorePreview=z.infer<typeof followUpRestorePreview>
export type FollowUpRestoreReceipt=z.infer<typeof followUpRestoreReceipt>
