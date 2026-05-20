import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { createTenantPrisma } from '@/server/db/middleware'
import { errorResponse, AppError } from '@/lib/errors'

/**
 * PATCH /api/admin/ai-prompts/[id] — Update an AI prompt configuration.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'settings:manage')

    const { id } = await params
    const body = await request.json()
    const { systemPrompt, isActive, name } = body

    const db = createTenantPrisma(session.organizationId)

    const existing = await db.aiPromptConfig.findFirst({ where: { id } })
    if (!existing) {
      throw new AppError('NOT_FOUND', 'AI prompt config not found', 404)
    }

    const data: Record<string, unknown> = {}
    if (systemPrompt !== undefined) data.systemPrompt = systemPrompt
    if (isActive !== undefined) data.isActive = isActive
    if (name !== undefined) data.name = name

    const updated = await db.aiPromptConfig.update({ where: { id }, data })

    return NextResponse.json({ data: updated })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * DELETE /api/admin/ai-prompts/[id] — Delete an AI prompt configuration.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'settings:manage')

    const { id } = await params
    const db = createTenantPrisma(session.organizationId)

    const existing = await db.aiPromptConfig.findFirst({ where: { id } })
    if (!existing) {
      throw new AppError('NOT_FOUND', 'AI prompt config not found', 404)
    }

    await db.aiPromptConfig.delete({ where: { id } })

    return NextResponse.json({ data: { id, deleted: true } })
  } catch (error) {
    return errorResponse(error)
  }
}
