import {z} from 'zod'
import {AppError} from '@/lib/errors'
import {followUpHttp} from '@/server/services/follow-up-http'
import {readFollowUpSendResult} from '@/server/services/email-send-results'
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 return followUpHttp(request,true,async session=>{
  if(new URL(request.url).search)throw new AppError('VALIDATION_ERROR','Use the current follow-up send status.',400)
  return {data:await readFollowUpSendResult(session.organizationId,session.dbUser.id,z.string().uuid().parse((await params).id)),canWrite:true}
 })
}
