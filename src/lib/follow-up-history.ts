import { z } from 'zod'
import {historyDateRange} from './follow-up-history-dates'
export const followUpHistoryKind = z.enum(['all','approved','dismissed','snoozed','woke','restored'])
export type FollowUpHistoryKind = z.infer<typeof followUpHistoryKind>
export const FOLLOW_UP_HISTORY_DATES_HEADER='x-flowrish-history-dates'
export const FOLLOW_UP_HISTORY_PAGE_HEADER='x-flowrish-history-page'
export const historyCursorToken=z.string().min(1).max(2048).regex(/^[A-Za-z0-9_-]+$/)
export function historyPagingFromRequest(request:Request){const value=request.headers.get(FOLLOW_UP_HISTORY_PAGE_HEADER);if(value===null)return false;z.literal('1').parse(value);return true}
export function historyDatesFromRequest(request:Request){const value=request.headers.get(FOLLOW_UP_HISTORY_DATES_HEADER);if(value===null)return false;z.literal('1').parse(value);z.literal(true).parse(historyPagingFromRequest(request));return true}
export const followUpHistoryQuery = z.object({ from:z.string().max(10).optional(),to:z.string().max(10).optional(),timeZone:z.string().max(100).optional(), kind: followUpHistoryKind.default('all'), cursor: historyCursorToken.optional(), page: z.coerce.number().int().min(1).max(10000).default(1) }).strict()
export const followUpHistoryEntry = z.object({ id: z.string().uuid(), kind: z.enum(['approved','dismissed','snoozed','woke','restored']), actor: z.literal('You'), occurredAt: z.string().datetime(), until: z.string().datetime().nullable(), timeZone: z.string().min(1).max(100).nullable() }).strict()
export const followUpHistoryData = z.object({ range:historyDateRange.nullable().optional(), paging:z.object({cursor:historyCursorToken,nextCursor:historyCursorToken.nullable()}).strict().optional(), kind: followUpHistoryKind.default('all'), id: z.string().min(1).max(128), page: z.number().int().min(1).max(10000), hasMore: z.boolean(), entries: z.array(followUpHistoryEntry).max(20), current: z.object({ state: z.enum(['pending','snoozed','due','approved','dismissed']), until: z.string().datetime().nullable(), timeZone: z.string().min(1).max(100).nullable(), checkedAt: z.string().datetime() }).strict() }).strict()
export type FollowUpHistoryData = z.infer<typeof followUpHistoryData>
export const followUpHistoryAction = (kind: z.infer<typeof followUpHistoryEntry>['kind']) => ({ approved: 'Approved follow-up', dismissed: 'Dismissed follow-up', snoozed: 'Snoozed follow-up', woke: 'Woke follow-up', restored: 'Restored to Pending' })[kind]
