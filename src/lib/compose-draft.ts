import {z} from 'zod'
export const COMPOSE_BINDING_HEADER='x-flowrish-compose-binding'
export const composeDraftBinding=z.object({leadId:z.string().min(1).max(128),recipientEmail:z.string().trim().toLowerCase().email().max(320),draftVersion:z.string().max(128).nullable(),threadId:z.string().min(1).max(512).nullable()}).strict()
export type ComposeDraftBinding=z.infer<typeof composeDraftBinding>
export const composeDraftContent=z.object({subject:z.string().max(200).refine(s=>!/[\r\n]/.test(s)),body:z.string().max(48000)}).strict()
export const composeDraftWrite=z.object({operationId:z.string().uuid(),expectedRevision:z.number().int().min(0).max(2_000_000_000),sourceVersion:z.string().regex(/^[a-f0-9]{64}$/),binding:composeDraftBinding,content:composeDraftContent.nullable()}).strict()
export const composeDraftSnapshot=z.object({id:z.string().min(1),sourceVersion:z.string().regex(/^[a-f0-9]{64}$/),revision:z.number().int().min(0).max(2_000_000_000),operationId:z.string().uuid().nullable(),updatedAt:z.string().datetime().nullable(),outdated:z.boolean(),content:composeDraftContent.nullable()}).strict()
export type ComposeDraftContent=z.infer<typeof composeDraftContent>
export type ComposeDraftWrite=z.infer<typeof composeDraftWrite>
export type ComposeDraftSnapshot=z.infer<typeof composeDraftSnapshot>
