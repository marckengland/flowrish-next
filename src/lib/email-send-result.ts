import {z} from 'zod'
export const emailSendReceipt=z.object({messageId:z.string().min(1).max(2048),threadId:z.string().min(1).max(2048),attachmentCount:z.number().int().min(0)}).strict()
export type EmailSendReceipt=z.infer<typeof emailSendReceipt>
export type DeliveryHooks={beforeDelivery:()=>Promise<void>;accepted:(result:EmailSendReceipt)=>Promise<void>}
export const emailSendResult=z.object({id:z.string().min(1),state:z.enum(['NONE','UNKNOWN','CONFIRMED','FAILED']),operationId:z.string().uuid().nullable(),updatedAt:z.string().datetime().nullable(),result:emailSendReceipt.nullable()}).strict().refine(value=>(value.state==='CONFIRMED')===(value.result!==null))
export type EmailSendResult=z.infer<typeof emailSendResult>
