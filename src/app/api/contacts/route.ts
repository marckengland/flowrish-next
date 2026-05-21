import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { getContacts, createContact } from '@/server/services/contacts'
import { paginationSchema } from '@/lib/validators/common'
import { errorResponse } from '@/lib/errors'

/**
 * GET /api/contacts — List contacts with pagination and optional filters.
 *
 * Query params: page, pageSize, search, companyId
 *
 * Validates: Requirement 19.1
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'contacts:read')

    const { searchParams } = request.nextUrl

    const pagination = paginationSchema.parse({
      page: searchParams.get('page') ?? undefined,
      pageSize: searchParams.get('pageSize') ?? undefined,
    })

    const filters = {
      search: searchParams.get('search') ?? undefined,
      companyId: searchParams.get('companyId') ?? undefined,
    }

    const result = await getContacts(filters, pagination, session.organizationId)

    return NextResponse.json({
      data: result.contacts,
      pagination: result.pagination,
    })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * POST /api/contacts — Create a new contact.
 *
 * Body: { firstName, lastName, ...optional fields }
 *
 * Validates: Requirement 19.1
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'contacts:write')

    const body = await request.json()
    const contact = await createContact(body, session.organizationId)

    revalidatePath('/contacts')

    return NextResponse.json({ data: contact }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
