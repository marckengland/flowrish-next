import { NextRequest,NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { extractKnowledgeFile } from '@/server/services/knowledge-extraction'
import { AppError,errorResponse } from '@/lib/errors'
export const maxDuration=60
const maxFile=2*1024*1024
const maxBody=maxFile+64*1024
async function boundedForm(request:NextRequest){
 const length=request.headers.get('content-length')
 if(length && (!/^\d+$/.test(length) || Number(length)>maxBody)) throw new AppError('UPLOAD_TOO_LARGE','Upload a file no larger than 2 MB.',413)
 const type=request.headers.get('content-type')??''
 if(!type.toLowerCase().startsWith('multipart/form-data;')) throw new AppError('INVALID_UPLOAD','Upload one file using multipart/form-data.',400)
 const reader=request.body?.getReader()
 if(!reader) throw new AppError('INVALID_UPLOAD','Choose a file to upload.',400)
 const parts:Uint8Array[]=[]
 let size=0
 try{
  while(true){const part=await reader.read();if(part.done) break;size+=part.value.byteLength;if(size>maxBody){await reader.cancel();throw new AppError('UPLOAD_TOO_LARGE','Upload a file no larger than 2 MB.',413)}parts.push(part.value)}
 }finally{reader.releaseLock()}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength}
 try{return await new Response(bytes,{headers:{'Content-Type':type}}).formData()}catch{throw new AppError('INVALID_UPLOAD','The upload could not be read. Choose the file again.',400)}
}
export async function POST(request:NextRequest){
 try{
  const session=await requireSession();requirePermission(session.dbUser,'admin:settings')
  const form=await boundedForm(request)
  const files=form.getAll('file')
  if(files.length!==1 || typeof files[0] === 'string') throw new AppError('INVALID_UPLOAD','Choose one supported file to upload.',400)
  const file=files[0]
  if(file.size>maxFile) throw new AppError('UPLOAD_TOO_LARGE','Upload a file no larger than 2 MB.',413)
  if(file.size===0) throw new AppError('INVALID_UPLOAD','The selected file is empty.',400)
  const data=await extractKnowledgeFile({name:file.name,type:file.type,bytes:new Uint8Array(await file.arrayBuffer())})
  return NextResponse.json({data})
 }catch(error){return errorResponse(error)}
}
