import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { generateFollowUpDraft } from '@/server/services/follow-up-drafts'
import { errorResponse } from '@/lib/errors'

export const maxDuration = 120

const bodySchema = z.object({ instructions: z.string().max(2000).optional() })
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:read')
    requirePermission(session.dbUser, 'leads:write')
    const id = z.string().uuid().parse((await context.params).id)
    const body = bodySchema.parse(await request.json())
    return NextResponse.json({ data: await generateFollowUpDraft(session.organizationId, session.dbUser.id, id, body.instructions) })
  } catch (error) { return errorResponse(error) }
}
