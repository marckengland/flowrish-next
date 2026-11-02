import { NextRequest,NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { transitionKnowledge } from '@/server/services/knowledge'
import { errorResponse } from '@/lib/errors'
export async function POST(request:NextRequest,context:{params:Promise<{id:string}>}){
 try{const session=await requireSession();requirePermission(session.dbUser,'admin:settings');const id=z.string().uuid().parse((await context.params).id);return NextResponse.json({data:await transitionKnowledge(session.organizationId,session.dbUser.id,id,await request.json())})}catch(error){return errorResponse(error)}
}
