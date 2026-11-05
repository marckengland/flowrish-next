import {z} from 'zod'
export const FOLLOW_UP_PAGE_HEADER='x-flowrish-follow-up-page'
const token=z.string().min(1).max(1024).regex(/^[A-Za-z0-9_-]+$/)
export const followUpPageRequest=z.object({after:token.optional()}).strict()
export const followUpPageMeta=z.object({nextCursor:token.nullable(),accessVersion:z.string().regex(/^[a-f0-9]{64}$/),callbackCatchUp:z.object({created:z.number().int().min(0).max(100),hasMore:z.boolean()}).strict().optional()}).strict()
export type FollowUpPageMeta=z.infer<typeof followUpPageMeta>
export function followUpPageFromRequest(request:Request) {
  const query=new URL(request.url).searchParams,header=request.headers.get(FOLLOW_UP_PAGE_HEADER)
  if(header===null&&!query.has('after'))return undefined
  z.literal('1').parse(header);z.array(z.string()).max(1).parse(query.getAll('after'))
  return followUpPageRequest.parse(query.has('after')?{after:query.get('after')}:{})
}
