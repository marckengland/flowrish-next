import {z} from 'zod'
import {followUpFilterSchema,followUpListQuery,type FollowUpFilters} from './follow-up-filters'
const count=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const followUpCountsSchema=z.object({counts:z.object({PENDING:count,APPROVED:count,DISMISSED:count,SNOOZED:count}).strict(),overdueTasks:count,checkedAt:z.string().datetime(),filters:followUpFilterSchema}).strict().refine(value=>value.overdueTasks<=value.counts.APPROVED,'Overdue tasks exceed matching approved follow-ups.')
export type FollowUpCounts=z.infer<typeof followUpCountsSchema>
export function followUpCountsQuery(filters:FollowUpFilters){const query=followUpListQuery('PENDING',filters);query.delete('status');return query}
export const followUpCountsFilterKey=(filters:FollowUpFilters)=>JSON.stringify(followUpFilterSchema.parse(filters))
