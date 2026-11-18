'use server'

import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import { prisma } from '@/server/db/client'
import { createOrganization, acceptInvite } from '@/server/services/organizations'
import { AppError } from '@/lib/errors'
import { z } from 'zod'

/**
 * Server Actions for the onboarding flow.
 * New users either create an organization or join one via invite code.
 *
 * Uses a lightweight auth check (Supabase user + app User lookup) instead of
 * requireSession(), because the user doesn't have an org membership yet —
 * that's what onboarding creates.
 *
 * Validates: Requirements 2.3
 */

async function requireAuthUser() {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    throw new AppError('UNAUTHORIZED', 'Authentication required', 401)
  }
  const dbUser = await prisma.user.findUnique({
    where: { authId: user.id },
  })
  if (!dbUser) {
    throw new AppError('UNAUTHORIZED', 'User record not found', 401)
  }
  return dbUser
}

const createOrgSchema = z.object({
  name: z
    .string()
    .min(1, 'Organization name is required')
    .max(100, 'Organization name must be 100 characters or less'),
  slug: z
    .string()
    .min(1, 'Slug is required')
    .max(50, 'Slug must be 50 characters or less')
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      'Slug must be lowercase letters, numbers, and hyphens only (no leading/trailing hyphens)',
    ),
})

const joinOrgSchema = z.object({
  inviteCode: z.string().min(1, 'Invite code is required'),
})

/**
 * Creates a new organization for the authenticated user.
 * On success, redirects to the dashboard.
 */
export async function createOrg(formData: FormData) {
  const dbUser = await requireAuthUser()

  const parsed = createOrgSchema.safeParse({
    name: formData.get('name'),
    slug: formData.get('slug'),
  })

  if (!parsed.success) {
    const firstError = parsed.error.issues[0]?.message ?? 'Invalid input'
    return { error: firstError }
  }

  const { name, slug } = parsed.data

  try {
    await createOrganization(name, slug, dbUser.id)
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'statusCode' in err) {
      const appErr = err as { message: string; statusCode: number }
      return { error: appErr.message }
    }
    return { error: 'Failed to create organization. Please try again.' }
  }

  redirect('/dashboard')
}

/**
 * Joins an existing organization via invite code (invite ID).
 * On success, redirects to the dashboard.
 */
export async function joinOrg(formData: FormData) {
  const dbUser = await requireAuthUser()

  const parsed = joinOrgSchema.safeParse({
    inviteCode: formData.get('inviteCode'),
  })

  if (!parsed.success) {
    const firstError = parsed.error.issues[0]?.message ?? 'Invalid input'
    return { error: firstError }
  }

  const { inviteCode } = parsed.data

  try {
    await acceptInvite(inviteCode, dbUser.id)
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'statusCode' in err) {
      const appErr = err as { message: string; statusCode: number }
      return { error: appErr.message }
    }
    return { error: 'Failed to accept invite. Please check the code and try again.' }
  }

  redirect('/dashboard')
}
