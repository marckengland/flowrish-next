import { NextRequest,NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { listKnowledge,createKnowledge } from '@/server/services/knowledge'
import { errorResponse } from '@/lib/errors'
export async function GET(){
 try{const session=await requireSession();requirePermission(session.dbUser,'admin:settings');return NextResponse.json({data:await listKnowledge(session.organizationId,session.dbUser.id)},{headers:{'Cache-Control':'no-store'}})}catch(error){return errorResponse(error)}
}
export async function POST(request:NextRequest){
 try{const session=await requireSession();requirePermission(session.dbUser,'admin:settings');return NextResponse.json({data:await createKnowledge(session.organizationId,session.dbUser.id,await request.json())},{status:201})}catch(error){return errorResponse(error)}
}
