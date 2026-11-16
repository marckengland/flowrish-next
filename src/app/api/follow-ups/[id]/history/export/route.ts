import {z} from 'zod'
import {listFollowUpHistory} from '@/server/services/follow-up-history'
import {followUpHttp,followUpId} from '@/server/services/follow-up-http'
export async function GET(request:Request,context:{params:Promise<{id:string}>}){
 return followUpHttp(request,false,async session=>{const query=new URL(request.url).searchParams;for(const key of ['page','kind','cursor','from','to','timeZone'])z.array(z.string()).max(1).parse(query.getAll(key));return listFollowUpHistory(session.organizationId,session.dbUser.id,followUpId((await context.params).id),Object.fromEntries(query),true,true,true)})
}
