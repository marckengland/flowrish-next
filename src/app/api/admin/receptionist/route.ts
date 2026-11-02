import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { prisma } from '@/server/db/client'
import { saveReceptionistConfig } from '@/server/services/receptionist'
import { callStateSchema } from '@/lib/receptionist'
import { errorResponse } from '@/lib/errors'

export async function GET() {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'admin:settings')
    const organizationId = session.organizationId
    const [stored, organization, members, stages, calls] = await Promise.all([
      prisma.receptionistConfig.findUnique({ where: { organizationId } }),
      prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
      prisma.organizationMember.findMany({ where: { organizationId }, select: { user: { select: { id: true, name: true } } } }),
      prisma.stage.findMany({ where: { pipeline: { organizationId }, isClosedWon: false, isClosedLost: false }, select: { id: true, name: true, pipeline: { select: { name: true } } }, orderBy: { order: 'asc' } }),
      prisma.receptionistCall.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' }, take: 10 }),
    ])
    return NextResponse.json({
      config: stored?.settings ?? null, businessName: organization?.name ?? '', currentUserId: session.dbUser.id,
      members: members.map((member) => member.user), stages, webhookPath: `/api/voice/receptionist/${organizationId}`,
      calls: calls.map((call) => {
        const state = callStateSchema.safeParse(call.state)
        return { id: call.id, status: call.status === 'active' && Date.now() - call.updatedAt.getTime() > 60 * 60 * 1000 ? 'incomplete' : call.status, createdAt: call.createdAt, leadId: call.leadId, fullName: state.success ? state.data.fullName : '', phone: state.success ? state.data.phone : '', reason: state.success ? state.data.reason : '', messages: state.success ? state.data.messages : [] }
      }),
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return errorResponse(error) }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'admin:settings')
    const config = await saveReceptionistConfig(session.organizationId, await request.json())
    return NextResponse.json({ config })
  } catch (error) { return errorResponse(error) }
}
