import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { inviteToOrganization } from '@/server/services/organizations'
import { createSupabaseAdmin } from '@/lib/supabase/admin'
import { errorResponse, AppError } from '@/lib/errors'

/**
 * POST /api/admin/invite — Invite a user to the organization.
 *
 * 1. Creates an OrganizationInvite record in the database
 * 2. Sends an invite email via Supabase Auth (magic link)
 *
 * When the invitee clicks the link and signs up/logs in, the auth callback
 * checks for pending invites matching their email and auto-accepts them.
 *
 * Body: { email, roleId, teamId? }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'admin:users')

    const body = await request.json()
    const { email, roleId, teamId } = body

    if (!email || typeof email !== 'string') {
      throw new AppError('VALIDATION_ERROR', 'Email is required', 400)
    }

    // 1. Create the invite record in our database
    const invite = await inviteToOrganization(
      email,
      session.organizationId,
      roleId,
      session.dbUser.id,
      teamId,
    )

    // 2. Send invite email via Supabase Auth
    // This sends a magic link email. When the user clicks it, they'll be
    // authenticated and redirected to /auth/callback where we check for
    // pending invites.
    const supabaseAdmin = createSupabaseAdmin()
    const { error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      email.trim().toLowerCase(),
      {
        redirectTo: `${process.env.NEXT_PUBLIC_SUPABASE_URL ? '' : ''}${getBaseUrl()}/auth/callback`,
        data: {
          invited_to_org: session.organizationId,
          invite_id: invite.id,
        },
      },
    )

    if (inviteError) {
      // If the email send fails, the invite record still exists.
      // The user can still join manually via the invite code on onboarding.
      console.error('Supabase invite email failed:', inviteError.message)
      // Don't throw — the invite was created successfully, email is best-effort
    }

    return NextResponse.json({ data: invite }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * Resolves the base URL for redirect links.
 * Uses NEXT_PUBLIC_SUPABASE_URL's origin pattern or falls back to Vercel URL.
 */
function getBaseUrl(): string {
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`
  }
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
}
