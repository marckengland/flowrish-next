import {z} from 'zod'
import {AppError} from '@/lib/errors'
import {followUpBody,followUpHttp,followUpId} from '@/server/services/follow-up-http'
import {previewFollowUpRestore,restoreFollowUp,readFollowUpRestore} from '@/server/services/follow-up-restore'
type Context={params:Promise<{id:string}>}
export async function GET(request:Request,context:Context){
 return followUpHttp(request,true,async session=>{
  const id=followUpId((await context.params).id),query=new URL(request.url).searchParams
  if([...query.keys()].some(key=>key!=='requestId')||query.getAll('requestId').length>1)throw new AppError('VALIDATION_ERROR','Choose one restore request.',400)
  const requestId=query.has('requestId')?z.string().uuid().parse(query.get('requestId')):undefined
  return {data:requestId?await readFollowUpRestore(session.organizationId,session.dbUser.id,id,requestId):await previewFollowUpRestore(session.organizationId,session.dbUser.id,id),canWrite:true}
 })
}
export async function POST(request:Request,context:Context){
 return followUpHttp(request,true,async session=>({data:await restoreFollowUp(session.organizationId,session.dbUser.id,followUpId((await context.params).id),await followUpBody(request)),canWrite:true}))
}
