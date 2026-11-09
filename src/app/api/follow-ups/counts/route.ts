import {AppError} from '@/lib/errors'
import {followUpFiltersFromQuery} from '@/lib/follow-up-filters'
import {sendStatusFromRequest} from '@/lib/follow-up-send-status'
import {readFollowUpCounts} from '@/server/services/follow-up-counts'
import {followUpHttp} from '@/server/services/follow-up-http'
export async function GET(request:Request){return followUpHttp(request,false,async session=>{
 const query=new URL(request.url).searchParams
 if([...query.keys()].some(key=>!['search','source','dueOnly','taskProgress','taskOrder','needsChecking'].includes(key)))throw new AppError('VALIDATION_ERROR','Use valid inbox count filters.',400)
 const filters=followUpFiltersFromQuery(query),sendStatus=sendStatusFromRequest(request)
 if(filters?.needsChecking&&!sendStatus)throw new AppError('VALIDATION_ERROR','Reload to use send status filters.',400)
 return readFollowUpCounts(session.organizationId,session.dbUser.id,filters??{})
})}
