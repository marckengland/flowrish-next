import {AppError} from '@/lib/errors'
import {followUpFiltersFromQuery} from '@/lib/follow-up-filters'
import {readFollowUpCounts} from '@/server/services/follow-up-counts'
import {followUpHttp} from '@/server/services/follow-up-http'
export async function GET(request:Request){return followUpHttp(request,false,async session=>{
 const query=new URL(request.url).searchParams
 if([...query.keys()].some(key=>!['search','source','dueOnly','taskProgress','taskOrder'].includes(key)))throw new AppError('VALIDATION_ERROR','Use valid inbox count filters.',400)
 return readFollowUpCounts(session.organizationId,session.dbUser.id,followUpFiltersFromQuery(query)??{})
})}
