import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { getContactById, updateContact, deleteContact } from '@/server/services/contacts'
import { errorResponse } from '@/lib/errors'

/**
 * GET /api/contacts/[id] — Get a single contact by ID.
 *
 * Validates: Requirement 19.1
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'contacts:read')

    const { id } = await params
    const contact = await getContactById(id, session.organizationId)

    return NextResponse.json({ data: contact })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * PATCH /api/contacts/[id] — Update a contact.
 *
 * Validates: Requirement 19.1
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'contacts:write')

    const { id } = await params
    const body = await request.json()
    const contact = await updateContact(id, body, session.organizationId)

    return NextResponse.json({ data: contact })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * DELETE /api/contacts/[id] — Delete a contact.
 *
 * Validates: Requirement 19.1
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'contacts:write')

    const { id } = await params
    await deleteContact(id, session.organizationId)

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return errorResponse(error)
  }
}
