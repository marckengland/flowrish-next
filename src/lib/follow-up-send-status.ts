import {z} from 'zod'
export const FOLLOW_UP_SEND_STATUS_HEADER='x-flowrish-send-status'
export const sendStatusMetadataSchema=z.object({state:z.enum(['NONE','UNKNOWN','CONFIRMED','FAILED']),updatedAt:z.string().datetime().nullable()}).strict()
export type SendStatusMetadata=z.infer<typeof sendStatusMetadataSchema>
export function sendStatusFromRequest(request:Request){const value=request.headers.get(FOLLOW_UP_SEND_STATUS_HEADER);if(value===null)return false;z.literal('1').parse(value);return true}
export const sendStatusLabel=(value:SendStatusMetadata)=>value.state==='CONFIRMED'?'Provider accepted':value.state==='FAILED'?'Send did not start':value.state==='UNKNOWN'?'Needs checking':null
