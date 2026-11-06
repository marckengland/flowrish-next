import { z } from 'zod'
import { taskProgressFilter } from './follow-up-task-progress'
export const followUpFilterSchema=z.object({search:z.string().trim().max(200).default(''),source:z.enum(['ALL','EMAIL','CALL']).default('ALL'),dueOnly:z.boolean().default(false),taskProgress:taskProgressFilter.optional()}).strict().refine(value=>!value.dueOnly||!value.taskProgress,'Choose due reminders or Approved task progress.')
export type FollowUpFilters=z.infer<typeof followUpFilterSchema>
export function followUpFiltersFromQuery(query:URLSearchParams):FollowUpFilters|undefined {
  const keys=['search','source','dueOnly','taskProgress'] as const
  if (!keys.some(key=>query.has(key))) return undefined
  for (const key of keys) z.array(z.string()).max(1).parse(query.getAll(key))
  return followUpFilterSchema.parse({search:query.get('search')??'',source:query.get('source')??'ALL',dueOnly:query.has('dueOnly')?z.enum(['0','1']).parse(query.get('dueOnly'))==='1':false,...(query.has('taskProgress')?{taskProgress:query.get('taskProgress')}:{})})
}
export function followUpListQuery(status:string,filters:FollowUpFilters):URLSearchParams {
  const query=new URLSearchParams({status})
  if(filters.search)query.set('search',filters.search)
  if(filters.source!=='ALL')query.set('source',filters.source)
  if(filters.dueOnly)query.set('dueOnly','1')
  if(filters.taskProgress)query.set('taskProgress',filters.taskProgress)
  return query
}
export const hasFollowUpFilters=(filters:FollowUpFilters)=>Boolean(filters.search||filters.source!=='ALL'||filters.dueOnly||filters.taskProgress)
