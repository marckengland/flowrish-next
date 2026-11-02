import { NextRequest,NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { getKnowledge,updateKnowledge } from '@/server/services/knowledge'
import { errorResponse } from '@/lib/errors'
type Context={params:Promise<{id:string}>}
export async function GET(_request:NextRequest,context:Context){
 try{const session=await requireSession();requirePermission(session.dbUser,'admin:settings');const id=z.string().uuid().parse((await context.params).id);return NextResponse.json({data:await getKnowledge(session.organizationId,session.dbUser.id,id)},{headers:{'Cache-Control':'no-store'}})}catch(error){return errorResponse(error)}
}
export async function PATCH(request:NextRequest,context:Context){
 try{const session=await requireSession();requirePermission(session.dbUser,'admin:settings');const id=z.string().uuid().parse((await context.params).id);return NextResponse.json({data:await updateKnowledge(session.organizationId,session.dbUser.id,id,await request.json())})}catch(error){return errorResponse(error)}
}
