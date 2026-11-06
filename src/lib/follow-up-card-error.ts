import {FollowUpClientError} from './follow-up-client'

export type FollowUpCardError = {message:string; dismissible:boolean}
const rejectedRequests = [['VALIDATION_ERROR',400],['PAYLOAD_TOO_LARGE',413],['FOLLOW_UP_PAUSED',503],['FOLLOW_UP_CHANGED',409]] as const
const rejectedDrafts = [['INVALID_SOURCE',400],['INVALID_SOURCE',409],['DRAFT_CONFLICT',409],['AI_DRAFT_FAILED',503],['AI_UNAVAILABLE',503]] as const

/** Only known rejections are dismissible; a lost response may follow a committed write. */
export function followUpCardError(cause:unknown, operation:'draft'|'review'):FollowUpCardError {
 const dismissible = cause instanceof FollowUpClientError && [...rejectedRequests,...(operation==='draft'?rejectedDrafts:[])].some(([code,status])=>cause.code===code&&cause.status===status)
 return {message:cause instanceof Error?cause.message:operation==='draft'?'Unable to generate this draft.':'Unable to update this follow-up.',dismissible}
}
