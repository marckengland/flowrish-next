import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { createTenantPrisma } from '@/server/db/middleware'
import { tenantData } from '@/server/db/types'
import { errorResponse } from '@/lib/errors'

/**
 * GET /api/admin/ai-prompts — List AI prompt configurations.
 */
export async function GET() {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'admin:settings')

    const db = createTenantPrisma(session.organizationId)
    const prompts = await db.aiPromptConfig.findMany({
      orderBy: { key: 'asc' },
    })

    return NextResponse.json({ data: prompts })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * POST /api/admin/ai-prompts — Create an AI prompt configuration.
 *
 * Body: { key, name, systemPrompt, isActive }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'admin:settings')

    const body = await request.json()
    const { key, name, systemPrompt, isActive } = body

    const db = createTenantPrisma(session.organizationId)
    const prompt = await db.aiPromptConfig.create({
      data: tenantData({
        key,
        name,
        systemPrompt,
        isActive: isActive ?? true,
      }),
    })

    return NextResponse.json({ data: prompt }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
