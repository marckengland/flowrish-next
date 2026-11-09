import {AppError} from '@/lib/errors'
import {COMPOSE_BINDING_HEADER,composeDraftBinding} from '@/lib/compose-draft'
import {followUpBody,followUpHttp,followUpId} from '@/server/services/follow-up-http'
import {readComposeDraft,writeComposeDraft} from '@/server/services/compose-drafts'
type Context={params:Promise<{id:string}>}
export async function GET(request:Request,{params}:Context){
 return followUpHttp(request,true,async session=>{
  if(new URL(request.url).search)throw new AppError('VALIDATION_ERROR','Use the current email draft.',400)
  let binding:unknown;try{binding=JSON.parse(request.headers.get(COMPOSE_BINDING_HEADER)??'')}catch{throw new AppError('VALIDATION_ERROR','Use a valid email draft binding.',400)}
  return {data:await readComposeDraft(session.organizationId,session.dbUser.id,followUpId((await params).id),composeDraftBinding.parse(binding)),canWrite:true}
 })
}
export async function PUT(request:Request,{params}:Context){
 return followUpHttp(request,true,async session=>({data:await writeComposeDraft(session.organizationId,session.dbUser.id,followUpId((await params).id),await followUpBody(request)),canWrite:true}))
}
